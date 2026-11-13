import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings, patchSettings } from "./config.js";
import { syncVault } from "./sync.js";
import { Vault } from "./store.js";
import { DEFAULT_ORIGIN } from "./types.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".pdf": "application/pdf",
};

function publicDir(): string {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    join(here, "public"),
    join(here, "../public"),
    join(process.cwd(), "public"),
  ];
  return candidates.find((dir) => existsSync(join(dir, "index.html"))) || candidates[1];
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body, null, 2));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function openapiSpec(port: number): unknown {
  return {
    openapi: "3.1.0",
    info: {
      title: "AZCL local vault",
      version: "0.1.0",
      summary: "Local AZCorpusLibrary vault — browse, search, and sync the Aziel Digital Library.",
      license: { name: "Apache-2.0" },
      contact: { name: "Aziel Eliab" },
    },
    servers: [{ url: `http://127.0.0.1:${port}` }],
    paths: {
      "/api/health": { get: { summary: "Vault health", responses: { "200": { description: "ok" } } } },
      "/api/status": { get: { summary: "Vault counts and ledger tip", responses: { "200": { description: "status" } } } },
      "/api/search": {
        get: {
          summary: "Search local installed records",
          parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
          responses: { "200": { description: "hits" } },
        },
      },
      "/api/records": { get: { summary: "List current master view", responses: { "200": { description: "records" } } } },
      "/api/records/{id}": { get: { summary: "One record + tips", responses: { "200": { description: "record" } } } },
      "/api/records/{id}/file": { get: { summary: "Verified file bytes", responses: { "200": { description: "bytes" } } } },
      "/api/records/{id}/metadata": { get: { summary: "Stored discovery metadata", responses: { "200": { description: "json" } } } },
      "/api/records/{id}/history": { get: { summary: "Append-only master history", responses: { "200": { description: "rows" } } } },
      "/api/tips": { get: { summary: "Hashchain tips", responses: { "200": { description: "tips" } } } },
      "/api/ledger": { get: { summary: "Sync ledger receipts", responses: { "200": { description: "ledger" } } } },
      "/api/master": { get: { summary: "Local master export", responses: { "200": { description: "master" } } } },
      "/api/settings": {
        get: { summary: "Read settings", responses: { "200": { description: "settings" } } },
        put: { summary: "Update settings", responses: { "200": { description: "settings" } } },
      },
      "/api/sync": { post: { summary: "Incremental (or full) sync", responses: { "200": { description: "summary" } } } },
    },
  };
}

export function startServer(options: {
  home: string;
  port?: number;
  host?: string;
}): Promise<{ port: number; close: () => Promise<void> }> {
  const home = options.home;
  const host = options.host || "127.0.0.1";
  const port = options.port ?? 7733;
  const root = publicDir();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}:${port}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
        "access-control-allow-headers": "Content-Type",
      });
      res.end();
      return;
    }

    try {
      if (url.pathname === "/openapi.json") {
        sendJson(res, 200, openapiSpec(port));
        return;
      }
      if (url.pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          product: "AZCL",
          name: "AZCorpusLibrary",
          author: "Aziel Eliab",
          lens: ["Service", "Clarity", "Peace"],
          origin_default: DEFAULT_ORIGIN,
        });
        return;
      }

      if (url.pathname.startsWith("/api/")) {
        const vault = new Vault(home);
        try {
          if (url.pathname === "/api/status" && req.method === "GET") {
            sendJson(res, 200, {
              settings: loadSettings(home),
              counts: vault.counts(),
              ledger_tip: vault.lastReceipt() || null,
              home,
            });
            return;
          }
          if (url.pathname === "/api/search" && req.method === "GET") {
            const q = url.searchParams.get("q") || "";
            sendJson(res, 200, { q, results: vault.search(q, Number(url.searchParams.get("limit") || 50)) });
            return;
          }
          if (url.pathname === "/api/records" && req.method === "GET") {
            sendJson(res, 200, {
              results: vault.listCurrent(Number(url.searchParams.get("limit") || 500), Number(url.searchParams.get("offset") || 0)),
            });
            return;
          }
          if (url.pathname === "/api/tips" && req.method === "GET") {
            sendJson(res, 200, { tips: vault.tips() });
            return;
          }
          if (url.pathname === "/api/ledger" && req.method === "GET") {
            sendJson(res, 200, { ledger: vault.ledger(Number(url.searchParams.get("limit") || 80)) });
            return;
          }
          if (url.pathname === "/api/master" && req.method === "GET") {
            sendJson(res, 200, vault.exportMaster());
            return;
          }
          if (url.pathname === "/api/settings" && req.method === "GET") {
            sendJson(res, 200, loadSettings(home));
            return;
          }
          if (url.pathname === "/api/settings" && req.method === "PUT") {
            const body = JSON.parse((await readBody(req)) || "{}") as Record<string, unknown>;
            const patch: Record<string, unknown> = {};
            if (typeof body.origin === "string") patch.origin = body.origin;
            if (typeof body.sync_on_start === "boolean") patch.sync_on_start = body.sync_on_start;
            if (typeof body.concurrency === "number") patch.concurrency = body.concurrency;
            sendJson(res, 200, patchSettings(home, patch));
            return;
          }
          if (url.pathname === "/api/sync" && req.method === "POST") {
            const body = JSON.parse((await readBody(req)) || "{}") as { full?: boolean };
            vault.close();
            const summary = await syncVault({ home, full: Boolean(body.full) });
            sendJson(res, 200, summary);
            return;
          }
          const recMatch = /^\/api\/records\/([^/]+)(?:\/(file|metadata|history))?$/.exec(url.pathname);
          if (recMatch && req.method === "GET") {
            const id = decodeURIComponent(recMatch[1]);
            const extra = recMatch[2];
            const current = vault.current(id);
            if (!current) {
              sendJson(res, 404, { error: "not_found", record_id: id });
              return;
            }
            if (extra === "history") {
              sendJson(res, 200, { record_id: id, history: vault.history(id) });
              return;
            }
            if (extra === "metadata") {
              const meta = current.metadata_sha256 ? vault.readMetadata(current.metadata_sha256) : null;
              sendJson(res, 200, meta || { record_id: id, note: "no local metadata companion" });
              return;
            }
            if (extra === "file") {
              const bytes = current.content_sha256 ? vault.readObject(current.content_sha256) : null;
              if (!bytes) {
                sendJson(res, 404, { error: "object_missing", record_id: id });
                return;
              }
              const filename = current.filename || `${id}.bin`;
              res.writeHead(200, {
                "content-type": filename.endsWith(".pdf") ? "application/pdf" : "application/octet-stream",
                "content-disposition": `inline; filename="${filename}"`,
                "content-length": bytes.length,
                "x-aziel-sha256": current.content_sha256,
                "access-control-allow-origin": "*",
              });
              res.end(bytes);
              return;
            }
            sendJson(res, 200, {
              record: current,
              history: vault.history(id),
              tips: vault.tips(id),
            });
            return;
          }
          sendJson(res, 404, { error: "unknown_api", path: url.pathname });
        } finally {
          try {
            vault.close();
          } catch {
            /* already closed after sync */
          }
        }
        return;
      }

      let filePath = join(root, url.pathname === "/" ? "index.html" : url.pathname);
      if (!existsSync(filePath) || url.pathname === "/") filePath = join(root, "index.html");
      if (!existsSync(filePath)) {
        sendJson(res, 404, { error: "ui_missing" });
        return;
      }
      const type = MIME[extname(filePath)] || "application/octet-stream";
      const body = readFileSync(filePath);
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}
