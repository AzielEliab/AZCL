import { test } from "node:test";
import assert from "node:assert/strict";
import { sha256Hex, verifyContent, isSha256, normalizeSha } from "../dist/hash.js";

test("sha256Hex matches known vector", () => {
  assert.equal(
    sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

test("verifyContent accepts matching bytes", () => {
  const bytes = Buffer.from("azcl-vault", "utf8");
  const expected = sha256Hex(bytes);
  const result = verifyContent(bytes, expected);
  assert.equal(result.ok, true);
  assert.equal(result.actual, expected);
});

test("verifyContent refuses mismatch and missing expected hash", () => {
  const bytes = Buffer.from("payload", "utf8");
  const bad = verifyContent(bytes, "0".repeat(64));
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "sha256_mismatch");
  const missing = verifyContent(bytes, "");
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_expected_sha256");
});

test("normalizeSha and isSha256", () => {
  assert.equal(normalizeSha("SHA256:ABC"), "abc");
  assert.equal(isSha256("0".repeat(64)), true);
  assert.equal(isSha256("nope"), false);
});
