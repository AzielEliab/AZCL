import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Vault } from "../dist/store.js";
import { sha256Hex } from "../dist/hash.js";

test("store never deletes prior master rows or CAS objects", () => {
  const home = mkdtempSync(join(tmpdir(), "azcl-store-"));
  const vault = new Vault(home);
  const a = Buffer.from("first-bytes");
  const b = Buffer.from("second-bytes");
  const shaA = sha256Hex(a);
  const shaB = sha256Hex(b);
  vault.putObject(a, shaA, { filename: "a.bin" });
  const r1 = vault.appendMaster({
    record_id: "AZDOC-KEEP",
    json_record_id: "JSONAZDOC-KEEP",
    title: "One",
    concept: "One",
    content_sha256: shaA,
    chain_tip: "t1",
    paper_chain_tip: "t1",
    paper_chain_sequence: 1,
    lattice_tip_json: null,
    library: "aziel",
    author: "Aziel Eliab",
    filename: "a.bin",
    metadata_sha256: null,
    added_utc: new Date().toISOString(),
    source: "test",
  });
  vault.setCurrent("AZDOC-KEEP", r1.seq, true);
  vault.putObject(b, shaB, { filename: "b.bin" });
  const r2 = vault.appendMaster({
    record_id: "AZDOC-KEEP",
    json_record_id: "JSONAZDOC-KEEP",
    title: "Two",
    concept: "Two",
    content_sha256: shaB,
    chain_tip: "t2",
    paper_chain_tip: "t2",
    paper_chain_sequence: 2,
    lattice_tip_json: null,
    library: "aziel",
    author: "Aziel Eliab",
    filename: "b.bin",
    metadata_sha256: null,
    added_utc: new Date().toISOString(),
    source: "test",
  });
  vault.setCurrent("AZDOC-KEEP", r2.seq, true);

  const history = vault.history("AZDOC-KEEP");
  assert.equal(history.length, 2);
  assert.equal(history[0].content_sha256, shaA);
  assert.equal(history[1].content_sha256, shaB);
  assert.equal(vault.hasObject(shaA), true);
  assert.equal(vault.hasObject(shaB), true);
  assert.equal(vault.readObject(shaA).equals(a), true);
  assert.equal(vault.current("AZDOC-KEEP")?.content_sha256, shaB);
  const counts = vault.counts();
  assert.equal(counts.master, 2);
  assert.equal(counts.objects, 2);
  vault.close();
  rmSync(home, { recursive: true, force: true });
});
