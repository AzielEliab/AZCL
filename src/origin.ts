import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sha256Hex } from "./hash.js";
import { snapshotPath } from "./paths.js";
import type { DiscoveryMetadata, PackedIndex, PackedIndexRecord } from "./types.js";

export class OriginError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function fetchText(
  url: string,
  userAgent: string,
): Promise<{ status: number; text: string; contentType: string }> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json, text/plain, */*",
    },
    redirect: "follow",
  });
  const text = await res.text();
  return {
    status: res.status,
    text,
    contentType: res.headers.get("content-type") || "",
  };
}

export async function fetchBytes(
  url: string,
  userAgent: string,
): Promise<{ status: number; bytes: Buffer; contentType: string; filename: string | null; reportedSha: string | null }> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      Accept: "*/*",
    },
    redirect: "follow",
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  const disposition = res.headers.get("content-disposition") || "";
  const nameMatch = /filename="?([^"]+)"?/i.exec(disposition);
  return {
    status: res.status,
    bytes,
    contentType: res.headers.get("content-type") || "application/octet-stream",
    filename: nameMatch?.[1] ?? null,
    reportedSha: (res.headers.get("x-aziel-sha256") || "").toLowerCase() || null,
  };
}

export function joinOrigin(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = origin.replace(/\/+$/, "");
  const rel = path.startsWith("/") ? path : `/${path}`;
  return `${base}${rel}`;
}

export async function fetchPackedIndex(
  origin: string,
  userAgent: string,
  home?: string,
): Promise<{ index: PackedIndex; index_sha256: string; records: PackedIndexRecord[] }> {
  const url = joinOrigin(origin, "/v1/library-index");
  const { status, text } = await fetchText(url, userAgent);
  if (status >= 400) {
    throw new OriginError(`library-index HTTP ${status}`, status);
  }
  let index: PackedIndex;
  try {
    index = JSON.parse(text) as PackedIndex;
  } catch {
    throw new OriginError("library-index is not JSON", status);
  }
  const records = Array.isArray(index.records) ? index.records : [];
  const index_sha256 = index.index_sha256 || sha256Hex(Buffer.from(text, "utf8"));
  if (home) {
    const stamp = (index.ts || new Date().toISOString()).replace(/[:.]/g, "-");
    const dest = snapshotPath(home, stamp);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text, "utf8");
  }
  return { index, index_sha256, records };
}

export async function fetchMetadata(
  origin: string,
  recordId: string,
  userAgent: string,
  metadataUrl?: string,
): Promise<DiscoveryMetadata | null> {
  const url = metadataUrl
    ? joinOrigin(origin, metadataUrl)
    : joinOrigin(origin, `/record/${encodeURIComponent(recordId)}/metadata.json`);
  const { status, text } = await fetchText(url, userAgent);
  if (status === 404) return null;
  if (status >= 400) throw new OriginError(`metadata ${recordId} HTTP ${status}`, status);
  try {
    return JSON.parse(text) as DiscoveryMetadata;
  } catch {
    throw new OriginError(`metadata ${recordId} is not JSON`, status);
  }
}

export async function fetchFile(
  origin: string,
  recordId: string,
  userAgent: string,
  fileUrl?: string,
): Promise<{ bytes: Buffer; contentType: string; filename: string | null; reportedSha: string | null }> {
  const url = fileUrl
    ? joinOrigin(origin, fileUrl)
    : joinOrigin(origin, `/file/${encodeURIComponent(recordId)}`);
  const result = await fetchBytes(url, userAgent);
  if (result.status >= 400) {
    throw new OriginError(`file ${recordId} HTTP ${result.status}`, result.status);
  }
  return result;
}

export function authorName(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value && "name" in value) {
    return String((value as { name?: unknown }).name || "") || null;
  }
  return null;
}
