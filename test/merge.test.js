import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMasterAppendOnly, currentMaster, needsRemotePull } from "../dist/merge.js";

function row(partial) {
  return {
    record_id: "AZDOC-TEST",
    json_record_id: "JSONAZDOC-TEST",
    title: "Title",
    concept: "Concept",
    content_sha256: "aa".repeat(32),
    chain_tip: "bb".repeat(32),
    paper_chain_tip: "bb".repeat(32),
    paper_chain_sequence: 1,
    lattice_tip_json: null,
    library: "aziel",
    author: "Aziel Eliab",
    filename: "a.pdf",
    metadata_sha256: "cc".repeat(32),
    added_utc: "2026-09-18T00:00:00.000Z",
    source: "test",
    ...partial,
  };
}

test("append-only merge keeps prior rows when sha or tip changes", () => {
  const first = row({});
  const once = mergeMasterAppendOnly([], first);
  assert.equal(once.appended, true);
  assert.equal(once.reason, "new");
  assert.equal(once.next.length, 1);

  const dup = mergeMasterAppendOnly(once.next, { ...first });
  assert.equal(dup.appended, false);
  assert.equal(dup.reason, "duplicate");
  assert.equal(dup.next.length, 1);

  const changed = row({ content_sha256: "dd".repeat(32), paper_chain_tip: "ee".repeat(32), chain_tip: "ee".repeat(32) });
  const twice = mergeMasterAppendOnly(once.next, changed);
  assert.equal(twice.appended, true);
  assert.equal(twice.reason, "changed");
  assert.equal(twice.next.length, 2);
  assert.equal(twice.next[0].content_sha256, first.content_sha256);
  assert.equal(currentMaster(twice.next, "AZDOC-TEST")?.content_sha256, changed.content_sha256);
});

test("needsRemotePull compares sha and tips and missing objects", () => {
  const current = row({});
  assert.equal(
    needsRemotePull(current, current, true),
    false,
  );
  assert.equal(
    needsRemotePull(current, current, false),
    true,
  );
  assert.equal(
    needsRemotePull(undefined, current, false),
    true,
  );
  assert.equal(
    needsRemotePull(current, { ...current, content_sha256: "ff".repeat(32) }, true),
    true,
  );
  assert.equal(
    needsRemotePull(current, { ...current, paper_chain_tip: "11".repeat(32), chain_tip: "11".repeat(32) }, true),
    true,
  );
});
