import type { MasterRow } from "./types.js";

export function masterFingerprint(row: Pick<
  MasterRow,
  | "record_id"
  | "content_sha256"
  | "paper_chain_tip"
  | "chain_tip"
  | "metadata_sha256"
  | "title"
  | "concept"
>): string {
  return [
    row.record_id,
    row.content_sha256 ?? "",
    row.paper_chain_tip ?? row.chain_tip ?? "",
    row.metadata_sha256 ?? "",
    row.title ?? "",
    row.concept ?? "",
  ].join("\n");
}

export function findMatchingMaster(
  history: readonly MasterRow[],
  incoming: MasterRow,
): MasterRow | undefined {
  const fp = masterFingerprint(incoming);
  return history.find((row) => masterFingerprint(row) === fp);
}

/**
 * Append-only master merge: never mutate or drop prior rows.
 * Same fingerprint is a no-op. Any discovery or hash change appends a new row.
 */
export function mergeMasterAppendOnly(
  history: readonly MasterRow[],
  incoming: MasterRow,
): { next: MasterRow[]; appended: boolean; reason: "duplicate" | "new" | "changed" } {
  const existingForId = history.filter((row) => row.record_id === incoming.record_id);
  if (findMatchingMaster(history, incoming)) {
    return { next: [...history], appended: false, reason: "duplicate" };
  }
  return {
    next: [...history, incoming],
    appended: true,
    reason: existingForId.length === 0 ? "new" : "changed",
  };
}

export function currentMaster(
  history: readonly MasterRow[],
  recordId: string,
): MasterRow | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i].record_id === recordId) return history[i];
  }
  return undefined;
}

export function needsRemotePull(
  current: MasterRow | undefined,
  remote: Pick<MasterRow, "content_sha256" | "paper_chain_tip" | "chain_tip" | "metadata_sha256">,
  objectPresent: boolean,
): boolean {
  if (!current) return true;
  if (!objectPresent) return true;
  if ((current.content_sha256 || "") !== (remote.content_sha256 || "")) return true;
  const localTip = current.paper_chain_tip || current.chain_tip || "";
  const remoteTip = remote.paper_chain_tip || remote.chain_tip || "";
  if (localTip !== remoteTip) return true;
  if (
    remote.metadata_sha256 &&
    current.metadata_sha256 &&
    current.metadata_sha256 !== remote.metadata_sha256
  ) {
    return true;
  }
  return false;
}
