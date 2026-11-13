import { createHash } from "node:crypto";

export function sha256Hex(bytes: Uint8Array | Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function normalizeSha(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
}

export function isSha256(value: string | null | undefined): boolean {
  return /^[a-f0-9]{64}$/.test(normalizeSha(value));
}

export type VerifyResult = {
  ok: boolean;
  expected: string;
  actual: string;
  reason?: string;
};

export function verifyContent(
  bytes: Uint8Array | Buffer,
  expectedSha256: string | null | undefined,
): VerifyResult {
  const actual = sha256Hex(bytes);
  const expected = normalizeSha(expectedSha256);
  if (!expected) {
    return { ok: false, expected, actual, reason: "missing_expected_sha256" };
  }
  if (!isSha256(expected)) {
    return { ok: false, expected, actual, reason: "invalid_expected_sha256" };
  }
  if (actual !== expected) {
    return { ok: false, expected, actual, reason: "sha256_mismatch" };
  }
  return { ok: true, expected, actual };
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

export function sha256Json(value: unknown): string {
  return sha256Hex(Buffer.from(stableJson(value), "utf8"));
}
