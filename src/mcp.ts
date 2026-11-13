import { loadSettings } from "./config.js";
import { syncVault } from "./sync.js";
import { Vault } from "./store.js";

type Json = Record<string, unknown>;

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

const TOOLS = [
  {
    name: "azcl_status",
    description: "Local AZCL vault counts, settings, and latest sync-ledger tip.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "azcl_search",
    description: "Search the local vault (offline) by title, concept, AZDOC id, sha256, or hashchain tip.",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string" }, limit: { type: "number" } },
      required: ["q"],
    },
  },
  {
    name: "azcl_get",
    description: "Get one local record, hashchain tips, and append-only master history.",
    inputSchema: {
      type: "object",
      properties: { record_id: { type: "string" } },
      required: ["record_id"],
    },
  },
  {
    name: "azcl_tips",
    description: "List stored hashchain / paper_chain tips for installed records.",
    inputSchema: {
      type: "object",
      properties: { record_id: { type: "string" } },
    },
  },
  {
    name: "azcl_ledger",
    description: "Read the append-only MESH-VAULT / ACT-RECEIPT style sync ledger.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number" } },
    },
  },
  {
    name: "azcl_sync",
    description: "Incremental sync from the live packed library index. Append-only; never deletes local history.",
    inputSchema: {
      type: "object",
      properties: { full: { type: "boolean" } },
    },
  },
];

async function callTool(home: string, name: string, args: Json): Promise<unknown> {
  if (name === "azcl_sync") {
    return syncVault({ home, full: Boolean(args.full) });
  }
  const vault = new Vault(home);
  try {
    if (name === "azcl_status") {
      return { settings: loadSettings(home), counts: vault.counts(), ledger_tip: vault.lastReceipt() || null, home };
    }
    if (name === "azcl_search") {
      return { q: args.q, results: vault.search(String(args.q || ""), Number(args.limit || 40)) };
    }
    if (name === "azcl_get") {
      const id = String(args.record_id || "");
      const record = vault.current(id);
      if (!record) return { error: "not_found", record_id: id };
      return { record, history: vault.history(id), tips: vault.tips(id) };
    }
    if (name === "azcl_tips") {
      return { tips: vault.tips(args.record_id ? String(args.record_id) : undefined) };
    }
    if (name === "azcl_ledger") {
      return { ledger: vault.ledger(Number(args.limit || 50)) };
    }
    return { error: "unknown_tool", name };
  } finally {
    vault.close();
  }
}

export async function runMcpStdio(home: string): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const write = (msg: unknown) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: Json };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      write(fail(null, -32700, "parse error"));
      continue;
    }
    const id = msg.id;
    const method = msg.method || "";
    const params = msg.params || {};
    try {
      if (method === "initialize") {
        write(
          ok(id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "azcl", version: "0.1.0", author: "Aziel Eliab" },
          }),
        );
        continue;
      }
      if (method === "notifications/initialized" || method === "initialized") continue;
      if (method === "tools/list") {
        write(ok(id, { tools: TOOLS }));
        continue;
      }
      if (method === "tools/call") {
        const name = String(params.name || "");
        const args = (params.arguments || {}) as Json;
        const result = await callTool(home, name, args);
        write(
          ok(id, {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
          }),
        );
        continue;
      }
      if (method === "ping") {
        write(ok(id, {}));
        continue;
      }
      write(fail(id, -32601, `unknown method ${method}`));
    } catch (err) {
      write(fail(id, -32000, err instanceof Error ? err.message : String(err)));
    }
  }
}
