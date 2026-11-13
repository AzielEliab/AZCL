---
title: AZCL (AZCorpusLibrary)
slug: azcl
author: Aziel Eliab
version: 0.1.0
date: 2026-09-18
license: Apache-2.0
shelf: aziel
domain: software, research
subjects: azcl aziel dossier
zion_pattern: not_applicable
---

# AZCL — AZCorpusLibrary

**Author:** Aziel Eliab  
**Version:** 0.1.0 (2026-09-18)  
**License:** Apache-2.0. Forks welcome.

## Identity

AZCL is the local client for the public Aziel Digital Library (`https://www.azielcorpuslibrary.net`). On first run it imports every packed-index record — file bytes plus hashchain and JSONAZDOC discovery metadata — into an append-only vault. While online it syncs new and changed records. While offline it serves a complete human UI and an MCP / OpenAPI agent door over that local store.

**This is not** the hosted library Worker, FragGate, a Softwares-tab chrome change, a VPN, an operator-token path, or a public mesh host. Reader replicas may serve localhost. They are not instructed to mask origin.

## Purpose

Give a human or an assistant a complete local copy of the public shelf: verified files, title, concept, and hashchain tips that remain queryable after the origin is unreachable.

## Concept

MESH-VAULT + packed `library:index:v1` (RL-WP-0.1-library): one index fetch, then per-record metadata and file GET on the front door only. Content-addressed objects. Append-only master and ACT-RECEIPT style sync ledger. Lamb Lens: Service → Clarity → Peace.

## Use cases

1. First install / first download auto-imports the live shelf.
2. Daily incremental sync without wiping prior local history.
3. Offline search by title, concept, AZDOC id, sha256, or chain tip.
4. Assistants query the same vault through MCP or OpenAPI.

## Coding / architecture notes

Portable TypeScript/Node 22. SQLite (`node:sqlite`) plus CAS directories under `~/.azcl`. CLI: `init`, `sync`, `search`, `get`, `serve`, `mcp`. HTTP UI and `/openapi.json` share one local server. FragGate is not this product's door; AZCL is a reader replica. Do not paste the whole repo here.

## Surfaces

- GitHub: https://github.com/AzielEliab/AZCL
- Library origin: https://www.azielcorpuslibrary.net
- Local UI: `azcl serve` → `http://127.0.0.1:7733`
- OpenAPI: `http://127.0.0.1:7733/openapi.json`
- MCP: `azcl mcp` (tools `azcl_status`, `azcl_search`, `azcl_get`, `azcl_tips`, `azcl_ledger`, `azcl_sync`)

## Related ecosystem

- Person `@id` https://www.azieleliab.com/#aziel
- Runtime `@id` https://www.azieleliab.com/runtime#runtime
- Neighbors: aziel-corpus, MESH-VAULT-1.0, RL-WP-0.1-library, ACT-RECEIPT-1.0, ChainLock CL-WP-0.4
