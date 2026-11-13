import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dbPath, objectPath, metaPath } from "./paths.js";
import { sha256Hex, sha256Json } from "./hash.js";
import { mergeMasterAppendOnly } from "./merge.js";
import { receiptHash, nowUtc, type ReceiptDraft } from "./receipt.js";
import type { LedgerRow, MasterRow, RecordView, SyncAction } from "./types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS master_index (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  json_record_id TEXT,
  title TEXT,
  concept TEXT,
  content_sha256 TEXT,
  chain_tip TEXT,
  paper_chain_tip TEXT,
  paper_chain_sequence INTEGER,
  lattice_tip_json TEXT,
  library TEXT,
  author TEXT,
  filename TEXT,
  metadata_sha256 TEXT,
  added_utc TEXT NOT NULL,
  source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  record_id TEXT PRIMARY KEY,
  master_seq INTEGER NOT NULL,
  installed INTEGER NOT NULL DEFAULT 0,
  updated_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS objects (
  content_sha256 TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  media_type TEXT,
  filename TEXT,
  stored_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  record_id TEXT,
  content_sha256 TEXT,
  chain_tip TEXT,
  detail TEXT,
  prev_hash TEXT,
  receipt_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_master_record ON master_index(record_id);
CREATE INDEX IF NOT EXISTS idx_master_sha ON master_index(content_sha256);
CREATE INDEX IF NOT EXISTS idx_master_tip ON master_index(paper_chain_tip);
`;

export class Vault {
  readonly home: string;
  readonly db: DatabaseSync;

  constructor(home: string) {
    this.home = home;
    mkdirSync(home, { recursive: true });
    mkdirSync(objectPath(home, "aa").slice(0, -2), { recursive: true });
    this.db = new DatabaseSync(dbPath(home));
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  hasObject(sha256: string): boolean {
    if (!sha256) return false;
    const row = this.db.prepare("SELECT content_sha256 FROM objects WHERE content_sha256 = ?").get(sha256);
    return Boolean(row) && existsSync(objectPath(this.home, sha256));
  }

  putObject(
    bytes: Uint8Array | Buffer,
    sha256: string,
    extra?: { media_type?: string; filename?: string | null },
  ): { stored: boolean; path: string } {
    const path = objectPath(this.home, sha256);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, bytes);
    }
    const storedUtc = nowUtc();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO objects (content_sha256, bytes, media_type, filename, stored_utc)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sha256, bytes.byteLength, extra?.media_type ?? null, extra?.filename ?? null, storedUtc);
    return { stored: true, path };
  }

  readObject(sha256: string): Buffer | null {
    const path = objectPath(this.home, sha256);
    if (!existsSync(path)) return null;
    return readFileSync(path);
  }

  putMetadata(metadata: unknown): string {
    const hex = sha256Json(metadata);
    const path = metaPath(this.home, hex);
    mkdirSync(dirname(path), { recursive: true });
    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify(metadata, null, 2) + "\n", "utf8");
    }
    return hex;
  }

  readMetadata(sha256: string): unknown | null {
    const path = metaPath(this.home, sha256);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  }

  history(recordId?: string): MasterRow[] {
    const sql = recordId
      ? "SELECT * FROM master_index WHERE record_id = ? ORDER BY seq ASC"
      : "SELECT * FROM master_index ORDER BY seq ASC";
    const rows = recordId
      ? (this.db.prepare(sql).all(recordId) as MasterRow[])
      : (this.db.prepare(sql).all() as MasterRow[]);
    return rows;
  }

  current(recordId: string): (MasterRow & { installed: boolean; master_seq: number; updated_utc: string }) | undefined {
    const row = this.db
      .prepare(
        `SELECT m.*, r.installed, r.master_seq, r.updated_utc
         FROM records r
         JOIN master_index m ON m.seq = r.master_seq
         WHERE r.record_id = ?`,
      )
      .get(recordId) as (MasterRow & { installed: number; master_seq: number; updated_utc: string }) | undefined;
    if (!row) return undefined;
    return { ...row, installed: Boolean(row.installed) };
  }

  /**
   * Append a master row if the discovery fingerprint is new.
   * Never deletes or rewrites prior master history.
   */
  appendMaster(incoming: MasterRow): { appended: boolean; seq: number; reason: "duplicate" | "new" | "changed" } {
    const history = this.history(incoming.record_id);
    const decision = mergeMasterAppendOnly(history, incoming);
    if (!decision.appended) {
      const last = history[history.length - 1];
      return { appended: false, seq: Number(last.seq), reason: "duplicate" };
    }
    const result = this.db
      .prepare(
        `INSERT INTO master_index (
          record_id, json_record_id, title, concept, content_sha256, chain_tip,
          paper_chain_tip, paper_chain_sequence, lattice_tip_json, library, author,
          filename, metadata_sha256, added_utc, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        incoming.record_id,
        incoming.json_record_id,
        incoming.title,
        incoming.concept,
        incoming.content_sha256,
        incoming.chain_tip,
        incoming.paper_chain_tip,
        incoming.paper_chain_sequence,
        incoming.lattice_tip_json,
        incoming.library,
        incoming.author,
        incoming.filename,
        incoming.metadata_sha256,
        incoming.added_utc,
        incoming.source,
      );
    return { appended: true, seq: Number(result.lastInsertRowid), reason: decision.reason };
  }

  setCurrent(recordId: string, masterSeq: number, installed: boolean): void {
    this.db
      .prepare(
        `INSERT INTO records (record_id, master_seq, installed, updated_utc)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(record_id) DO UPDATE SET
           master_seq = excluded.master_seq,
           installed = excluded.installed,
           updated_utc = excluded.updated_utc`,
      )
      .run(recordId, masterSeq, installed ? 1 : 0, nowUtc());
  }

  listCurrent(limit = 500, offset = 0): RecordView[] {
    const rows = this.db
      .prepare(
        `SELECT m.*, r.installed, r.master_seq, r.updated_utc
         FROM records r
         JOIN master_index m ON m.seq = r.master_seq
         ORDER BY m.title COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<MasterRow & { installed: number; master_seq: number; updated_utc: string }>;
    return rows.map((row) => ({ ...row, installed: Boolean(row.installed) }));
  }

  search(q: string, limit = 50): RecordView[] {
    const needle = `%${q.trim()}%`;
    if (!q.trim()) return this.listCurrent(limit, 0);
    const rows = this.db
      .prepare(
        `SELECT m.*, r.installed, r.master_seq, r.updated_utc
         FROM records r
         JOIN master_index m ON m.seq = r.master_seq
         WHERE m.title LIKE ? COLLATE NOCASE
            OR m.concept LIKE ? COLLATE NOCASE
            OR m.record_id LIKE ? COLLATE NOCASE
            OR IFNULL(m.json_record_id,'') LIKE ? COLLATE NOCASE
            OR IFNULL(m.content_sha256,'') LIKE ? COLLATE NOCASE
            OR IFNULL(m.paper_chain_tip,'') LIKE ? COLLATE NOCASE
            OR IFNULL(m.chain_tip,'') LIKE ? COLLATE NOCASE
            OR IFNULL(m.author,'') LIKE ? COLLATE NOCASE
            OR IFNULL(m.library,'') LIKE ? COLLATE NOCASE
         ORDER BY m.title COLLATE NOCASE ASC
         LIMIT ?`,
      )
      .all(needle, needle, needle, needle, needle, needle, needle, needle, needle, limit) as Array<
      MasterRow & { installed: number; master_seq: number; updated_utc: string }
    >;
    return rows.map((row) => ({ ...row, installed: Boolean(row.installed) }));
  }

  tips(recordId?: string): Array<{ record_id: string; paper_chain_tip: string | null; chain_tip: string | null; content_sha256: string; paper_chain_sequence: number | null }> {
    const sql = recordId
      ? `SELECT m.record_id, m.paper_chain_tip, m.chain_tip, m.content_sha256, m.paper_chain_sequence
         FROM records r JOIN master_index m ON m.seq = r.master_seq WHERE r.record_id = ?`
      : `SELECT m.record_id, m.paper_chain_tip, m.chain_tip, m.content_sha256, m.paper_chain_sequence
         FROM records r JOIN master_index m ON m.seq = r.master_seq ORDER BY m.record_id`;
    return recordId
      ? (this.db.prepare(sql).all(recordId) as Array<{ record_id: string; paper_chain_tip: string | null; chain_tip: string | null; content_sha256: string; paper_chain_sequence: number | null }>)
      : (this.db.prepare(sql).all() as Array<{ record_id: string; paper_chain_tip: string | null; chain_tip: string | null; content_sha256: string; paper_chain_sequence: number | null }>);
  }

  counts(): { master: number; current: number; installed: number; objects: number; ledger: number } {
    const one = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      master: one("SELECT COUNT(*) AS n FROM master_index"),
      current: one("SELECT COUNT(*) AS n FROM records"),
      installed: one("SELECT COUNT(*) AS n FROM records WHERE installed = 1"),
      objects: one("SELECT COUNT(*) AS n FROM objects"),
      ledger: one("SELECT COUNT(*) AS n FROM sync_ledger"),
    };
  }

  lastReceipt(): LedgerRow | undefined {
    return this.db.prepare("SELECT * FROM sync_ledger ORDER BY seq DESC LIMIT 1").get() as LedgerRow | undefined;
  }

  ledger(limit = 50): LedgerRow[] {
    return this.db.prepare("SELECT * FROM sync_ledger ORDER BY seq DESC LIMIT ?").all(limit) as LedgerRow[];
  }

  appendReceipt(input: {
    action: SyncAction | string;
    record_id?: string | null;
    content_sha256?: string | null;
    chain_tip?: string | null;
    detail?: string | null;
  }): LedgerRow {
    const last = this.lastReceipt();
    const nextSeq = last ? last.seq + 1 : 1;
    const draft: ReceiptDraft = {
      seq: nextSeq,
      ts: nowUtc(),
      action: input.action,
      record_id: input.record_id ?? null,
      content_sha256: input.content_sha256 ?? null,
      chain_tip: input.chain_tip ?? null,
      detail: input.detail ?? null,
      prev_hash: last?.receipt_hash ?? null,
    };
    const hash = receiptHash(draft);
    this.db
      .prepare(
        `INSERT INTO sync_ledger (seq, ts, action, record_id, content_sha256, chain_tip, detail, prev_hash, receipt_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        draft.seq,
        draft.ts,
        draft.action,
        draft.record_id,
        draft.content_sha256,
        draft.chain_tip,
        draft.detail,
        draft.prev_hash,
        hash,
      );
    return { ...draft, receipt_hash: hash };
  }

  exportMaster(): unknown {
    const records = this.listCurrent(10_000, 0);
    return {
      schema: "aziel.library.master.v1",
      author: "Aziel Eliab",
      updated_utc: nowUtc(),
      append_only: true,
      records_count: records.length,
      records: records.map((row) => ({
        record_id: row.record_id,
        json_record_id: row.json_record_id,
        title: row.title,
        concept: row.concept,
        content_sha256: row.content_sha256,
        paper_chain_tip: row.paper_chain_tip,
        paper_chain_sequence: row.paper_chain_sequence,
        chain_tip: row.chain_tip,
        library: row.library,
        filename: row.filename,
        metadata_sha256: row.metadata_sha256,
        added_utc: row.added_utc,
        installed: row.installed,
      })),
    };
  }

  digestNote(): string {
    const tip = this.lastReceipt();
    return sha256Hex(Buffer.from(tip?.receipt_hash || "empty", "utf8"));
  }
}
