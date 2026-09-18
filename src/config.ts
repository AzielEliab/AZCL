import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { DEFAULT_ORIGIN, DEFAULT_USER_AGENT, type Settings } from "./types.js";
import { settingsPath } from "./paths.js";

export const DEFAULT_SETTINGS: Settings = {
  origin: DEFAULT_ORIGIN,
  sync_on_start: true,
  user_agent: DEFAULT_USER_AGENT,
  concurrency: 4,
};

export function loadSettings(home: string): Settings {
  const path = settingsPath(home);
  if (!existsSync(path)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Settings>;
    return {
      origin: String(raw.origin || DEFAULT_SETTINGS.origin).replace(/\/+$/, ""),
      sync_on_start: raw.sync_on_start !== false,
      user_agent: String(raw.user_agent || DEFAULT_SETTINGS.user_agent),
      concurrency: Math.max(1, Number(raw.concurrency) || DEFAULT_SETTINGS.concurrency),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(home: string, settings: Settings): Settings {
  mkdirSync(home, { recursive: true });
  const next: Settings = {
    origin: settings.origin.replace(/\/+$/, ""),
    sync_on_start: settings.sync_on_start !== false,
    user_agent: settings.user_agent || DEFAULT_USER_AGENT,
    concurrency: Math.max(1, Number(settings.concurrency) || 4),
  };
  writeFileSync(settingsPath(home), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

export function patchSettings(home: string, patch: Partial<Settings>): Settings {
  return saveSettings(home, { ...loadSettings(home), ...patch });
}
