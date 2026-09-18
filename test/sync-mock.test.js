import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { syncVault } from "../dist/sync.js";
import { Vault } from "../dist/store.js";
import { saveSettings, DEFAULT_SETTINGS } from "../dist/config.js";

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test("mock origin first import then incremental append-only update", async () => {
  const fileA1 = Buffer.from("%PDF-1.4 first edition");
  const fileA2 = Buffer.from("%PDF-1.4 revised edition");
  const fileB = Buffer.from("%PDF-1.4 sibling paper");
  const shaA1 = sha(fileA1);
  const shaA2 = sha(fileA2);
  const shaB = sha(fileB);
  let edition = 1;

  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url, origin);
    const shaA = edition === 1 ? shaA1 : shaA2;
    const tipA = edition === 1 ? "aa".repeat(32) : "ab".repeat(32);
    if (url.pathname === "/v1/library-index") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          key: "library:index:v1",
          index_sha256: "11".repeat(32),
          records: [
            {
              record_id: "AZDOC-MOCKA",
              title: edition === 1 ? "Paper A" : "Paper A revised",
              library: "aziel",
              content_sha256: shaA,
              chain_tip: tipA,
              metadata_url: "/record/AZDOC-MOCKA/metadata.json",
            },
            {
              record_id: "AZDOC-MOCKB",
              title: "Paper B",
              library: "aziel",
              content_sha256: shaB,
              chain_tip: "bb".repeat(32),
              metadata_url: "/record/AZDOC-MOCKB/metadata.json",
            },
          ],
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/metadata.json")) {
      const id = url.pathname.split("/")[2];
      const rec =
        id === "AZDOC-MOCKA"
          ? {
              record_id: id,
              json_record_id: "JSONAZDOC-MOCKA",
              title: edition === 1 ? "Paper A" : "Paper A revised",
              subject: "concept A",
              content_sha256: shaA,
              paper_chain_tip: tipA,
              paper_chain_sequence: edition,
              lattice_tip: { schema: "aziel.lattice.anchor.v1", paper_chain_tip: tipA },
              library: "aziel",
              filename: "a.pdf",
            }
          : {
              record_id: id,
              json_record_id: "JSONAZDOC-MOCKB",
              title: "Paper B",
              subject: "concept B",
              content_sha256: shaB,
              paper_chain_tip: "bb".repeat(32),
              paper_chain_sequence: 1,
              library: "aziel",
              filename: "b.pdf",
            };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(rec));
      return;
    }
    if (url.pathname === "/file/AZDOC-MOCKA") {
      const body = edition === 1 ? fileA1 : fileA2;
      res.writeHead(200, { "content-type": "application/pdf", "x-aziel-sha256": sha(body) });
      res.end(body);
      return;
    }
    if (url.pathname === "/file/AZDOC-MOCKB") {
      res.writeHead(200, { "content-type": "application/pdf", "x-aziel-sha256": shaB });
      res.end(fileB);
      return;
    }
    res.writeHead(404);
    res.end("no");
  });

  const home = mkdtempSync(join(tmpdir(), "azcl-sync-"));
  saveSettings(home, { ...DEFAULT_SETTINGS, origin, sync_on_start: false, concurrency: 2 });

  const first = await syncVault({ home, origin });
  assert.equal(first.imported, 2);
  assert.equal(first.failed, 0);
  let vault = new Vault(home);
  assert.equal(vault.counts().installed, 2);
  assert.equal(vault.current("AZDOC-MOCKA")?.content_sha256, shaA1);
  assert.equal(vault.search("concept A")[0]?.record_id, "AZDOC-MOCKA");
  vault.close();

  edition = 2;
  const second = await syncVault({ home, origin });
  assert.equal(second.updated, 1);
  assert.equal(second.failed, 0);
  vault = new Vault(home);
  const history = vault.history("AZDOC-MOCKA");
  assert.equal(history.length, 2);
  assert.equal(history[0].content_sha256, shaA1);
  assert.equal(history[1].content_sha256, shaA2);
  assert.equal(vault.hasObject(shaA1), true);
  assert.equal(vault.hasObject(shaA2), true);
  assert.equal(vault.current("AZDOC-MOCKA")?.title, "Paper A revised");
  assert.equal(vault.tips("AZDOC-MOCKA")[0].paper_chain_tip, "ab".repeat(32));
  const offline = vault.search("Paper B");
  assert.equal(offline.length, 1);
  vault.close();

  server.close();
  rmSync(home, { recursive: true, force: true });
});

test("hash mismatch is ledgered and not marked installed", async () => {
  const body = Buffer.from("real-bytes");
  const { server, origin } = await listen((req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname === "/v1/library-index") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          key: "library:index:v1",
          records: [
            {
              record_id: "AZDOC-BAD",
              title: "Bad hash",
              content_sha256: "00".repeat(32),
              chain_tip: "cc".repeat(32),
            },
          ],
        }),
      );
      return;
    }
    if (url.pathname.endsWith("/metadata.json")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ record_id: "AZDOC-BAD", content_sha256: "00".repeat(32), title: "Bad hash" }));
      return;
    }
    if (url.pathname === "/file/AZDOC-BAD") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(body);
      return;
    }
    res.writeHead(404);
    res.end("no");
  });

  const home = mkdtempSync(join(tmpdir(), "azcl-bad-"));
  saveSettings(home, { ...DEFAULT_SETTINGS, origin, sync_on_start: false });
  const summary = await syncVault({ home, origin });
  assert.equal(summary.failed, 1);
  assert.equal(summary.imported, 0);
  const vault = new Vault(home);
  assert.equal(vault.current("AZDOC-BAD"), undefined);
  assert.equal(vault.ledger().some((row) => row.action === "verify_fail"), true);
  vault.close();
  server.close();
  rmSync(home, { recursive: true, force: true });
});
