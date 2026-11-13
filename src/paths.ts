import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function defaultHome(): string {
  if (process.env.AZCL_HOME) return resolve(process.env.AZCL_HOME);
  return join(homedir(), ".azcl");
}

export function objectPath(home: string, sha256: string): string {
  const hex = sha256.toLowerCase();
  return join(home, "objects", hex.slice(0, 2), hex);
}

export function metaPath(home: string, sha256: string): string {
  const hex = sha256.toLowerCase();
  return join(home, "meta", hex.slice(0, 2), `${hex}.json`);
}

export function snapshotPath(home: string, stamp: string): string {
  return join(home, "snapshots", `library-index-${stamp}.json`);
}

export function dbPath(home: string): string {
  return join(home, "vault.sqlite");
}

export function settingsPath(home: string): string {
  return join(home, "settings.json");
}
