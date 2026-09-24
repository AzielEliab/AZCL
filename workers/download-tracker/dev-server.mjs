/**
 * Local landing server for preview. Not used in production.
 * node workers/download-tracker/dev-server.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./src/index.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dir, "public");
const kv = new Map();

const env = {
  DOWNLOADS: {
    async get(key) {
      return kv.has(key) ? kv.get(key) : null;
    },
    async put(key, value) {
      kv.set(key, String(value));
    },
    async list() {
      return { keys: [...kv.keys()].map((name) => ({ name })), list_complete: true };
    },
  },
  ASSETS: {
    async fetch(request) {
      const name = path.basename(new URL(request.url).pathname);
      try {
        const buf = await readFile(path.join(publicDir, name));
        return new Response(buf, {
          status: 200,
          headers: { "content-length": String(buf.length) },
        });
      } catch {
        return new Response("missing", { status: 404 });
      }
    },
  },
};

function isWorkerPath(pathname) {
  if (pathname === "/" || pathname === "/stats" || pathname === "/event" || pathname === "/go" || pathname === "/count" || pathname === "/install.sh" || pathname === "/download") {
    return true;
  }
  return pathname.startsWith("/download/");
}

const port = Number(process.env.PORT || 8787);
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (!isWorkerPath(url.pathname)) {
    try {
      const name = path.basename(url.pathname);
      const buf = await readFile(path.join(publicDir, name));
      const type = name.endsWith(".png") ? "image/png" : "application/octet-stream";
      res.writeHead(200, { "content-type": type, "content-length": buf.length, "cache-control": "no-store" });
      res.end(buf);
      return;
    } catch {
      /* fall through to the worker */
    }
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  let body;
  if (req.method !== "GET" && req.method !== "HEAD") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }
  const request = new Request(url, { method: req.method, headers, body });
  const response = await worker.fetch(request, env);
  const out = {};
  response.headers.forEach((value, key) => {
    out[key] = value;
  });
  const buf = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, out);
  res.end(buf);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`http://127.0.0.1:${port}\n`);
});
