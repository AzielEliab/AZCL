import { sha256Hex, stableJson } from "./hash.js";
import { LEDGER_SCHEMA, type SyncAction } from "./types.js";

export type ReceiptDraft = {
  seq: number;
  ts: string;
  action: SyncAction | string;
  record_id: string | null;
  content_sha256: string | null;
  chain_tip: string | null;
  detail: string | null;
  prev_hash: string | null;
};

export function receiptHash(draft: ReceiptDraft): string {
  return sha256Hex(
    Buffer.from(
      stableJson({
        schema: LEDGER_SCHEMA,
        seq: draft.seq,
        ts: draft.ts,
        action: draft.action,
        record_id: draft.record_id,
        content_sha256: draft.content_sha256,
        chain_tip: draft.chain_tip,
        detail: draft.detail,
        prev: draft.prev_hash,
      }),
      "utf8",
    ),
  );
}

export function nowUtc(): string {
  return new Date().toISOString();
}
