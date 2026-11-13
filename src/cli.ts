#!/usr/bin/env node
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { defaultHome, dbPath } from "./paths.js";
import { loadSettings, patchSettings, saveSettings, DEFAULT_SETTINGS } from "./config.js";
import { syncVault } from "./sync.js";
import { Vault } from "./store.js";
import { startServer } from "./server.js";
import { runMcpStdio } from "./mcp.js";

function print(value: unknown, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    return;
  }
  if (typeof value === "string") {
    process.stdout.write(value + "\n");
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const pref = args.find((a) => a.startsWith(`${name}=`));
  return pref ? pref.slice(name.length + 1) : undefined;
}

function usage(): string {
  return `AZCL — AZCorpusLibrary local vault
Author: Aziel Eliab    License: Apache-2.0
Lamb Lens: Service → Clarity → Peace

Usage:
  azcl init [--home DIR] [--origin URL] [--limit N]
  azcl sync [--full] [--home DIR] [--origin URL] [--limit N]
  azcl status
  azcl search <query>
  azcl get <AZDOC-…>
  azcl tips [AZDOC-…]
  azcl ledger [--limit N]
  azcl serve [--port 7733] [--no-sync]
  azcl mcp
  azcl settings [origin=URL] [sync_on_start=true|false]
  azcl master

Environment:
  AZCL_HOME     vault directory (default ~/.azcl)

First run imports the entire public packed index, verifies each file
against content_sha256, and stores hashchain / JSONAZDOC discovery
metadata. Later syncs are incremental and append-only.
`;
}

function parseHome(args: string[]): string {
  return resolve(opt(args, "--home") || defaultHome());
}

function progressLine(message: string): void {
  process.stderr.write(`\r${message.padEnd(100).slice(0, 100)}`);
}

async function ensureInit(home: string, args: string[], forceFull = false): Promise<void> {
  const settings = existsSync(dbPath(home)) ? loadSettings(home) : saveSettings(home, DEFAULT_SETTINGS);
  const origin = opt(args, "--origin") || settings.origin;
  if (opt(args, "--origin")) patchSettings(home, { origin });
  const limitRaw = opt(args, "--limit");
  const summary = await syncVault({
    home,
    origin,
    full: forceFull || flag(args, "--full"),
    limit: limitRaw ? Number(limitRaw) : undefined,
    onProgress: (ev) => progressLine(ev.message),
  });
  process.stderr.write("\n");
  print(summary, flag(args, "--json"));
}

async function main(argv = process.argv.slice(2)): Promise<number> {
  const cmd = argv[0] || "help";
  const args = argv.slice(1);
  const json = flag(argv, "--json") || flag(args, "--json");
  const home = parseHome(argv);

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    print(usage(), false);
    return 0;
  }
  if (cmd === "init") {
    saveSettings(home, { ...DEFAULT_SETTINGS, ...loadSettings(home), origin: opt(args, "--origin") || loadSettings(home).origin });
    const vault = new Vault(home);
    vault.appendReceipt({ action: "init", detail: home });
    vault.close();
    await ensureInit(home, args, true);
    return 0;
  }
  if (cmd === "sync") {
    await ensureInit(home, args, flag(args, "--full"));
    return 0;
  }
  if (cmd === "status") {
    const vault = new Vault(home);
    print({ home, settings: loadSettings(home), counts: vault.counts(), ledger_tip: vault.lastReceipt() || null }, true);
    vault.close();
    return 0;
  }
  if (cmd === "search") {
    const q = args.filter((a) => !a.startsWith("--")).join(" ");
    const vault = new Vault(home);
    print({ q, results: vault.search(q) }, true);
    vault.close();
    return 0;
  }
  if (cmd === "get") {
    const id = args.find((a) => !a.startsWith("--"));
    if (!id) {
      print("azcl get <AZDOC-…>", false);
      return 2;
    }
    const vault = new Vault(home);
    const record = vault.current(id);
    if (!record) {
      print({ error: "not_found", record_id: id }, true);
      vault.close();
      return 1;
    }
    print({ record, history: vault.history(id), tips: vault.tips(id) }, true);
    vault.close();
    return 0;
  }
  if (cmd === "tips") {
    const id = args.find((a) => !a.startsWith("--"));
    const vault = new Vault(home);
    print({ tips: vault.tips(id) }, true);
    vault.close();
    return 0;
  }
  if (cmd === "ledger") {
    const vault = new Vault(home);
    print({ ledger: vault.ledger(Number(opt(args, "--limit") || 40)) }, true);
    vault.close();
    return 0;
  }
  if (cmd === "master") {
    const vault = new Vault(home);
    print(vault.exportMaster(), true);
    vault.close();
    return 0;
  }
  if (cmd === "settings") {
    const patch: Record<string, string | boolean | number> = {};
    for (const a of args) {
      if (!a.includes("=") || a.startsWith("--")) continue;
      const [k, ...rest] = a.split("=");
      const v = rest.join("=");
      if (k === "origin") patch.origin = v;
      if (k === "sync_on_start") patch.sync_on_start = v !== "false" && v !== "0";
      if (k === "concurrency") patch.concurrency = Number(v);
    }
    const next = Object.keys(patch).length ? patchSettings(home, patch) : loadSettings(home);
    print(next, true);
    return 0;
  }
  if (cmd === "serve") {
    const settings = loadSettings(home);
    if (settings.sync_on_start && !flag(args, "--no-sync")) {
      await ensureInit(home, args, !existsSync(dbPath(home)));
    }
    const port = Number(opt(args, "--port") || process.env.AZCL_PORT || 7733);
    const started = await startServer({ home, port });
    process.stderr.write(`AZCL UI  http://127.0.0.1:${started.port}\nOpenAPI  http://127.0.0.1:${started.port}/openapi.json\n`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        started.close().finally(() => resolve());
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
    return 0;
  }
  if (cmd === "mcp") {
    const settings = loadSettings(home);
    if (settings.sync_on_start && !existsSync(dbPath(home))) {
      await ensureInit(home, args, true);
    }
    await runMcpStdio(home);
    return 0;
  }
  print(usage(), false);
  return cmd ? 2 : 0;
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err) => {
    process.stderr.write((err instanceof Error ? err.stack || err.message : String(err)) + "\n");
    process.exit(1);
  },
);
