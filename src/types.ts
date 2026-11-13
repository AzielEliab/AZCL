export const DEFAULT_ORIGIN = "https://www.azielcorpuslibrary.net";
export const DEFAULT_USER_AGENT = "Mozilla/5.0 AZCL/0.1 (AZCorpusLibrary; +https://www.azielcorpuslibrary.net)";
export const MASTER_SCHEMA = "aziel.library.master.v1";
export const LEDGER_SCHEMA = "azcl.sync-ledger.v1";
export const INDEX_KEY = "library:index:v1";

export type Settings = {
  origin: string;
  sync_on_start: boolean;
  user_agent: string;
  concurrency: number;
};

export type PackedIndexRecord = {
  id?: string;
  record_id?: string;
  title?: string;
  shelf?: string;
  library?: string;
  author?: string;
  content_sha256?: string;
  chain_tip?: string;
  paper_chain_tip?: string;
  paper_chain_sequence?: number;
  updated?: string;
  ts?: string;
  created_utc?: string;
  domain?: string;
  subjects?: string;
  keywords?: string;
  filename?: string;
  href?: string;
  metadata_url?: string;
  concept?: string;
  json_record_id?: string;
};

export type PackedIndex = {
  ok?: boolean;
  key?: string;
  version?: number;
  ts?: string;
  index_sha256?: string;
  author?: string;
  records?: PackedIndexRecord[];
};

export type DiscoveryMetadata = {
  record_id?: string;
  json_record_id?: string;
  title?: string;
  name?: string;
  headline?: string;
  subject?: string;
  concept?: string;
  content_sha256?: string;
  paper_chain_tip?: string;
  paper_chain_sequence?: number;
  chain_tip?: string;
  lattice_tip?: unknown;
  library?: string;
  author?: unknown;
  filename?: string;
  metadata_sha256?: string;
  file_url?: string;
  content_url?: string;
  metadata_url?: string;
  [key: string]: unknown;
};

export type MasterRow = {
  seq?: number;
  record_id: string;
  json_record_id: string | null;
  title: string;
  concept: string;
  content_sha256: string;
  chain_tip: string | null;
  paper_chain_tip: string | null;
  paper_chain_sequence: number | null;
  lattice_tip_json: string | null;
  library: string | null;
  author: string | null;
  filename: string | null;
  metadata_sha256: string | null;
  added_utc: string;
  source: string;
};

export type RecordView = MasterRow & {
  installed: boolean;
  master_seq: number;
  updated_utc: string;
};

export type SyncAction =
  | "import"
  | "update"
  | "skip"
  | "verify_fail"
  | "fetch_fail"
  | "index"
  | "init";

export type LedgerRow = {
  seq: number;
  ts: string;
  action: SyncAction | string;
  record_id: string | null;
  content_sha256: string | null;
  chain_tip: string | null;
  detail: string | null;
  prev_hash: string | null;
  receipt_hash: string;
};

export type SyncProgress = {
  phase: "index" | "record" | "done";
  current: number;
  total: number;
  record_id?: string;
  title?: string;
  action?: string;
  message: string;
};

export type SyncSummary = {
  origin: string;
  index_sha256: string | null;
  remote_count: number;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  installed: number;
  ledger_tip: string | null;
};

export type ProgressSink = (event: SyncProgress) => void;
