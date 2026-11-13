import { loadSettings } from "./config.js";
import { normalizeSha, verifyContent } from "./hash.js";
import { needsRemotePull } from "./merge.js";
import { nowUtc } from "./receipt.js";
import {
  authorName,
  fetchFile,
  fetchMetadata,
  fetchPackedIndex,
  joinOrigin,
} from "./origin.js";
import { Vault } from "./store.js";
import type {
  DiscoveryMetadata,
  MasterRow,
  PackedIndexRecord,
  ProgressSink,
  SyncSummary,
} from "./types.js";

export type SyncOptions = {
  home: string;
  origin?: string;
  full?: boolean;
  limit?: number;
  onProgress?: ProgressSink;
};

function recordIdOf(rec: PackedIndexRecord): string | null {
  const id = rec.record_id || rec.id;
  return id ? String(id) : null;
}

function conceptOf(rec: PackedIndexRecord, meta: DiscoveryMetadata | null): string {
  return String(
    meta?.concept ||
      meta?.subject ||
      rec.concept ||
      rec.subjects ||
      meta?.headline ||
      rec.title ||
      "",
  );
}

function titleOf(rec: PackedIndexRecord, meta: DiscoveryMetadata | null): string {
  return String(meta?.title || meta?.name || meta?.headline || rec.title || recordIdOf(rec) || "");
}

function toMaster(
  rec: PackedIndexRecord,
  meta: DiscoveryMetadata | null,
  contentSha: string,
  metadataSha: string | null,
  source: string,
): MasterRow {
  const id = recordIdOf(rec)!;
  const paperTip = String(meta?.paper_chain_tip || rec.paper_chain_tip || rec.chain_tip || "") || null;
  const chainTip = String(meta?.chain_tip || rec.chain_tip || paperTip || "") || null;
  const seqRaw = meta?.paper_chain_sequence ?? rec.paper_chain_sequence;
  return {
    record_id: id,
    json_record_id: String(meta?.json_record_id || rec.json_record_id || (id.startsWith("AZDOC-") ? `JSON${id}` : "")) || null,
    title: titleOf(rec, meta),
    concept: conceptOf(rec, meta),
    content_sha256: contentSha,
    chain_tip: chainTip,
    paper_chain_tip: paperTip,
    paper_chain_sequence: typeof seqRaw === "number" ? seqRaw : seqRaw ? Number(seqRaw) : null,
    lattice_tip_json: meta?.lattice_tip ? JSON.stringify(meta.lattice_tip) : null,
    library: String(meta?.library || rec.library || rec.shelf || "") || null,
    author: authorName(meta?.author) || rec.author || null,
    filename: String(meta?.filename || rec.filename || "") || null,
    metadata_sha256: metadataSha,
    added_utc: nowUtc(),
    source,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      out[i] = await fn(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

export async function syncVault(options: SyncOptions): Promise<SyncSummary> {
  const settings = loadSettings(options.home);
  const origin = (options.origin || settings.origin).replace(/\/+$/, "");
  const vault = new Vault(options.home);
  const summary: SyncSummary = {
    origin,
    index_sha256: null,
    remote_count: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    installed: 0,
    ledger_tip: null,
  };

  try {
    options.onProgress?.({
      phase: "index",
      current: 0,
      total: 0,
      message: `Fetching packed index from ${origin}`,
    });
    const packed = await fetchPackedIndex(origin, settings.user_agent, options.home);
    summary.index_sha256 = packed.index_sha256;
    const records = packed.records.filter((rec) => recordIdOf(rec));
    const work = typeof options.limit === "number" ? records.slice(0, options.limit) : records;
    summary.remote_count = records.length;
    vault.appendReceipt({
      action: "index",
      detail: JSON.stringify({
        index_sha256: packed.index_sha256,
        remote_count: records.length,
        taking: work.length,
        full: Boolean(options.full),
      }),
    });

    await mapPool(work, settings.concurrency, async (rec, i) => {
      const id = recordIdOf(rec)!;
      const expectedSha = normalizeSha(rec.content_sha256);
      const current = vault.current(id);
      const objectPresent = expectedSha ? vault.hasObject(expectedSha) : false;
      const remoteHint = {
        content_sha256: expectedSha,
        paper_chain_tip: rec.paper_chain_tip || rec.chain_tip || null,
        chain_tip: rec.chain_tip || null,
        metadata_sha256: null,
      };
      const pull = options.full || needsRemotePull(current, remoteHint, objectPresent);

      if (!pull && current?.installed) {
        summary.skipped += 1;
        options.onProgress?.({
          phase: "record",
          current: i + 1,
          total: work.length,
          record_id: id,
          title: rec.title,
          action: "skip",
          message: `${i + 1}/${work.length} ${id} unchanged`,
        });
        return;
      }

      let meta: DiscoveryMetadata | null = null;
      try {
        meta = await fetchMetadata(origin, id, settings.user_agent, rec.metadata_url);
      } catch (err) {
        summary.failed += 1;
        vault.appendReceipt({
          action: "fetch_fail",
          record_id: id,
          detail: `metadata: ${err instanceof Error ? err.message : String(err)}`,
        });
        options.onProgress?.({
          phase: "record",
          current: i + 1,
          total: work.length,
          record_id: id,
          action: "fetch_fail",
          message: `${i + 1}/${work.length} ${id} metadata failed`,
        });
        return;
      }

      const wantSha = normalizeSha(meta?.content_sha256 || rec.content_sha256);
      let metadataSha: string | null = null;
      if (meta) metadataSha = vault.putMetadata(meta);

      let bytes: Buffer | null = objectPresent && wantSha ? vault.readObject(wantSha) : null;
      let mediaType: string | undefined;
      let filename = meta?.filename || rec.filename || null;

      if (!bytes || !wantSha || !vault.hasObject(wantSha)) {
        try {
          const file = await fetchFile(
            origin,
            id,
            settings.user_agent,
            typeof meta?.file_url === "string"
              ? meta.file_url
              : typeof meta?.content_url === "string"
                ? meta.content_url
                : joinOrigin(origin, `/file/${id}`),
          );
          bytes = file.bytes;
          mediaType = file.contentType;
          filename = file.filename || filename;
        } catch (err) {
          summary.failed += 1;
          vault.appendReceipt({
            action: "fetch_fail",
            record_id: id,
            content_sha256: wantSha || null,
            detail: `file: ${err instanceof Error ? err.message : String(err)}`,
          });
          options.onProgress?.({
            phase: "record",
            current: i + 1,
            total: work.length,
            record_id: id,
            action: "fetch_fail",
            message: `${i + 1}/${work.length} ${id} file failed`,
          });
          return;
        }
      }

      const verify = verifyContent(bytes, wantSha);
      if (!verify.ok) {
        summary.failed += 1;
        vault.appendReceipt({
          action: "verify_fail",
          record_id: id,
          content_sha256: verify.actual,
          detail: JSON.stringify(verify),
        });
        options.onProgress?.({
          phase: "record",
          current: i + 1,
          total: work.length,
          record_id: id,
          action: "verify_fail",
          message: `${i + 1}/${work.length} ${id} hash mismatch`,
        });
        return;
      }

      vault.putObject(bytes, verify.actual, { media_type: mediaType, filename });
      const row = toMaster(rec, meta, verify.actual, metadataSha, origin);
      const appended = vault.appendMaster(row);
      vault.setCurrent(id, appended.seq, true);
      if (appended.reason === "new") summary.imported += 1;
      else if (appended.reason === "changed") summary.updated += 1;
      else summary.skipped += 1;
      vault.appendReceipt({
        action: appended.reason === "changed" ? "update" : appended.reason === "new" ? "import" : "skip",
        record_id: id,
        content_sha256: verify.actual,
        chain_tip: row.paper_chain_tip || row.chain_tip,
        detail: appended.reason,
      });
      options.onProgress?.({
        phase: "record",
        current: i + 1,
        total: work.length,
        record_id: id,
        title: row.title,
        action: appended.reason,
        message: `${i + 1}/${work.length} ${id} ${appended.reason} ${verify.actual.slice(0, 12)}…`,
      });
    });

    summary.installed = vault.counts().installed;
    const tip = vault.lastReceipt();
    summary.ledger_tip = tip?.receipt_hash ?? null;
    options.onProgress?.({
      phase: "done",
      current: work.length,
      total: work.length,
      message: `Done. imported=${summary.imported} updated=${summary.updated} skipped=${summary.skipped} failed=${summary.failed}`,
    });
    return summary;
  } finally {
    vault.close();
  }
}

export function openVault(home: string): Vault {
  return new Vault(home);
}
