# AZCL — AZCorpusLibrary

Local vault client for the [Aziel Digital Library](https://www.azielcorpuslibrary.net/).

On **first download / first run** AZCL pulls the live packed `library:index:v1`, then imports **every filed record**: file bytes **and** hashchain / discovery metadata (`content_sha256`, `chain_tip` / `paper_chain_tip`, JSONAZDOC companion fields, title, concept). Bytes are stored only after SHA-256 verify.

When **online**, `azcl sync` compares index tips and content hashes, downloads new or changed records, verifies them, and **appends** them to the local store. Prior objects and master rows are never deleted.

When **offline**, search and browse use the local SQLite + content-addressed store.

Dual-surface: human UI (`azcl serve`) and agent front door (MCP stdio + OpenAPI).

Author: **Aziel Eliab**. License: **Apache-2.0**. Lamb Lens: **Service → Clarity → Peace**.

## Install

Requires Node.js 22+ (uses `node:sqlite`).

```bash
git clone https://github.com/AzielEliab/AZCL.git
cd AZCL
npm install
npm run build
npm test
npm link          # optional; puts `azcl` on PATH
```

Or run without linking:

```bash
node dist/cli.js --help
```

Vault home defaults to `~/.azcl`. Override with `--home DIR` or `AZCL_HOME`.

## First-run import

```bash
azcl init
```

This creates the vault, fetches:

- `GET https://www.azielcorpuslibrary.net/v1/library-index`
- `GET /record/{AZDOC-…}/metadata.json`
- `GET /file/{AZDOC-…}`

verifies each body against `content_sha256`, then writes:

- CAS objects keyed by `content_sha256`
- append-only `master_index` (title, concept, tips, JSONAZDOC id)
- MESH-VAULT / ACT-RECEIPT style `sync_ledger`

Progress prints to stderr. Re-running `init` / `sync` is safe: unchanged records are skipped.

## Sync

```bash
azcl sync            # incremental: compare sha + chain tips
azcl sync --full     # re-check every remote card
azcl status
```

Online sync **adds** new or changed records. It does not wipe local history. Old file bytes stay in the object store; old discovery rows stay in `master_index`.

## Offline browse

After import:

```bash
azcl search harmonic
azcl get AZDOC-C9AA00D1FAE5
azcl tips
azcl ledger
azcl master
azcl serve --no-sync          # http://127.0.0.1:7733
```

The browser UI searches the local vault, shows hashchain tips, opens verified files, and can trigger sync when the network is back.

## Settings

```bash
azcl settings
azcl settings origin=https://www.azielcorpuslibrary.net sync_on_start=true
```

Default origin is the public library host. **No operator token** is used or stored. Front-door GETs only.

`azcl serve` runs a first sync when `sync_on_start` is true (the default).

## MCP / OpenAPI

**MCP** (stdio JSON-RPC, protocol `2024-11-05`):

```bash
azcl mcp
```

Tools: `azcl_status`, `azcl_search`, `azcl_get`, `azcl_tips`, `azcl_ledger`, `azcl_sync`.

Example Claude / Cursor MCP config:

```json
{
  "mcpServers": {
    "azcl": {
      "command": "azcl",
      "args": ["mcp"],
      "env": { "AZCL_HOME": "/path/to/.azcl" }
    }
  }
}
```

**OpenAPI** while the UI is up:

```
http://127.0.0.1:7733/openapi.json
GET  /api/health /api/status /api/search?q= /api/records /api/records/{id}
GET  /api/records/{id}/file /metadata /history
GET  /api/tips /api/ledger /api/master /api/settings
POST /api/sync
PUT  /api/settings
```

Public live search remains available at `GET /v1/search?q=…` on the origin; AZCL’s agent door queries the **local** vault so assistants keep working offline.

## Data model

| Path | Role |
|------|------|
| `vault.sqlite` | current record pointer, append-only master, object catalog, sync ledger |
| `objects/xx/<sha256>` | file bytes (CAS; never overwritten with different bytes) |
| `meta/xx/<sha256>.json` | discovery / JSONAZDOC companion |
| `snapshots/` | packed index copies (MESH-VAULT) |
| `settings.json` | origin + sync-on-start |

Verify happens **before** a record is marked installed. A hash mismatch is a ledger `verify_fail` and is not installed. A live first-run against the public shelf (284 packed cards) imported 275 verified records and left 9 fail-closed; a later incremental sync appended tip/metadata updates without wiping those 275 objects.

## Download

The counted landing is the Worker `azcl-download-tracker`. It is not deployed from this repository. A teammate deploys it to:

https://azcl-download-tracker.vibelock.workers.dev/

`GET /download` returns `azcl-0.1.0.tar.gz`, the client source packed from this repo. Create KV namespace `AZCL_DOWNLOADS`, put its id in `workers/download-tracker/wrangler.toml`, and deploy that Worker. See `workers/download-tracker/README.md`.

Rebuild the gzip after client changes:

```bash
node scripts/pack-release.mjs
```

## Tests

```bash
npm test
```

Covers SHA-256 verify, append-only master merge, CAS retention, a mock-origin first import plus incremental update, and the download tracker (real gzip, counts per branch and fork).

## Identity

AZCL is a local reader replica of the public Aziel shelf. Author: Aziel Eliab. License: Apache-2.0.

Companion papers in `docs/`: MESH-VAULT-1.0, RL-WP-0.1-library, SOFTWARE-SITE-DOSSIER-1.0.

One-file dossier: [`dossiers/azcl-aziel-dossier-1.0.md`](dossiers/azcl-aziel-dossier-1.0.md).
