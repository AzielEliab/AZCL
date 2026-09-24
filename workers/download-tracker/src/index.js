import { classifyRequest, readBotManagement } from "./classify.js";
import {
  isolatedKeys,
  isReservedCounterKey,
  shapeCountBody,
  shapeHumanBotFields,
} from "./stats-shape.js";
import { HOST, VERSION, renderHome } from "./home.js";

/**
 * AZCL download tracker.
 *
 * GET /            landing (counts a page view)
 * GET /download    counted gzip of azcl-<version>.tar.gz (HTTP 200, no GitHub redirect)
 * GET /count       {project, views, downloads, total} plus human/bot split
 * GET /stats       totals, per-repo, per-branch, per-fork
 * POST /event      forks report a download {owner,repo,branch,fork,asset}
 * GET /install.sh  install script (does not itself increment; it curls /download)
 *
 * KV keys: project|owner|repo|branch|fork
 * Reserved counters are excluded from the breakdown.
 * GET never enables a mesh, a vault, or any other product.
 */

export const PROJECT = "azcl";
export const DEFAULT_ASSET = `azcl-${VERSION}.tar.gz`;
export const DEFAULT_OWNER = "AzielEliab";
export const DEFAULT_REPO = "AZCL";
export const DEFAULT_BRANCH = "main";
export const WORKER_HOST = HOST;

const KEYS = isolatedKeys(PROJECT);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, User-Agent",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...corsHeaders(),
    },
  });
}

function cleanLabel(value, fallback, max = 120) {
  const s = String(value ?? "").trim();
  if (!s || s.length > max || /[|\u0000-\u001f]/.test(s)) return fallback;
  return s;
}

function splitOwnerRepo(value, fallbackOwner, fallbackRepo) {
  if (typeof value === "string" && value.includes("/")) {
    const [o, r] = value.split("/").filter(Boolean);
    if (o && r) return { owner: cleanLabel(o, fallbackOwner), repo: cleanLabel(r, fallbackRepo) };
  }
  return { owner: fallbackOwner, repo: fallbackRepo };
}

export function parseDims(src) {
  const get = (k) => {
    if (src == null) return null;
    if (typeof src.get === "function") {
      const v = src.get(k);
      return v == null || v === "" ? null : v;
    }
    const v = src[k];
    return v == null || v === "" ? null : v;
  };

  let owner = cleanLabel(get("owner"), DEFAULT_OWNER);
  let repo = cleanLabel(get("repo"), DEFAULT_REPO);
  if (typeof repo === "string" && repo.includes("/")) {
    const split = splitOwnerRepo(repo, owner, DEFAULT_REPO);
    owner = split.owner;
    repo = split.repo;
  }

  const branch = cleanLabel(get("branch"), DEFAULT_BRANCH);
  const tag = cleanLabel(get("tag"), "latest", 40);
  const asset = get("asset") || "";

  const forkRaw = get("fork");
  let fork = "0";
  if (forkRaw === 1 || forkRaw === true || forkRaw === "1" || forkRaw === "true") {
    fork = "1";
  } else if (typeof forkRaw === "string" && forkRaw.includes("/")) {
    const split = splitOwnerRepo(forkRaw, owner, repo);
    owner = split.owner;
    repo = split.repo;
    fork = "1";
  } else if (forkRaw != null && forkRaw !== 0 && forkRaw !== false && forkRaw !== "0" && forkRaw !== "false") {
    fork = "1";
  }

  if (`${owner}/${repo}`.toLowerCase() !== `${DEFAULT_OWNER}/${DEFAULT_REPO}`.toLowerCase()) {
    fork = "1";
  }

  return { project: PROJECT, owner, repo, branch, fork, tag, asset };
}

export function kvKey(dims) {
  return `${dims.project}|${dims.owner}|${dims.repo}|${dims.branch}|${dims.fork}`;
}

export function resolveAsset(raw) {
  if (raw == null || raw === "") return DEFAULT_ASSET;
  const base = String(raw).split("/").filter(Boolean).pop();
  if (base !== DEFAULT_ASSET) return null;
  return base;
}

function hasKv(env) {
  return !!(env && env.DOWNLOADS && typeof env.DOWNLOADS.get === "function");
}

async function bump(env, key) {
  const n = parseInt((await env.DOWNLOADS.get(key)) || "0", 10) + 1;
  await env.DOWNLOADS.put(key, String(n));
  return n;
}

async function incrementSplit(env, humanKey, botKey, request) {
  const cls = classifyRequest(request);
  const splitKey = cls.bucket === "human" ? humanKey : botKey;
  await bump(env, splitKey);
  return cls;
}

async function incrementDownload(env, dims, request) {
  if (!hasKv(env)) return { counted: false, count: 0 };
  const n = await bump(env, kvKey(dims));
  await bump(env, KEYS.total);
  if (request) await incrementSplit(env, KEYS.downloads_human, KEYS.downloads_bot, request);
  return { counted: true, count: n };
}

async function incrementViews(env, request) {
  if (!hasKv(env)) return 0;
  const n = await bump(env, KEYS.views);
  if (request) await incrementSplit(env, KEYS.views_human, KEYS.views_bot, request);
  return n;
}

async function listAllKeys(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.DOWNLOADS.list(cursor ? { cursor } : {});
    keys.push(...(page.keys || []));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function githubStats(env) {
  const empty = { stars: 0, forks: 0, watchers: 0, release_download_count: 0, fetched_at: 0 };
  if (!hasKv(env)) return empty;
  const cached = await env.DOWNLOADS.get(KEYS.github);
  if (cached) {
    try {
      const obj = JSON.parse(cached);
      if (obj && obj.fetched_at && Date.now() - obj.fetched_at < 5 * 60 * 1000) return obj;
    } catch {
      /* ignore broken cache */
    }
  }
  const headers = {
    "User-Agent": "Mozilla/5.0 AZCL-download-tracker",
    Accept: "application/vnd.github+json",
  };
  let stars = 0;
  let forks = 0;
  let watchers = 0;
  let release_download_count = 0;
  try {
    const repoRes = await fetch("https://api.github.com/repos/AzielEliab/AZCL", {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (repoRes.ok) {
      const repo = await repoRes.json();
      stars = Number(repo.stargazers_count) || 0;
      forks = Number(repo.forks_count) || 0;
      watchers = Number(repo.subscribers_count != null ? repo.subscribers_count : repo.watchers_count) || 0;
    }
    const relRes = await fetch("https://api.github.com/repos/AzielEliab/AZCL/releases/latest", {
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (relRes.ok) {
      const rel = await relRes.json();
      const assets = Array.isArray(rel.assets) ? rel.assets : [];
      release_download_count = assets.reduce((s, a) => s + (Number(a.download_count) || 0), 0);
    }
  } catch {
    /* public API; zeros stay honest */
  }
  const out = { stars, forks, watchers, release_download_count, fetched_at: Date.now() };
  try {
    await env.DOWNLOADS.put(KEYS.github, JSON.stringify(out));
  } catch {
    /* ignore */
  }
  return out;
}

export async function collectStats(env, request, { github = true } = {}) {
  let total = 0;
  const by_repo = {};
  const by_branch = {};
  const by_fork = { "0": 0, "1": 0 };
  const breakdown = [];

  if (hasKv(env)) {
    const keys = await listAllKeys(env);
    for (const k of keys) {
      const name = k.name;
      if (isReservedCounterKey(name, PROJECT)) continue;
      const n = parseInt((await env.DOWNLOADS.get(name)) || "0", 10);
      if (!Number.isFinite(n) || n <= 0) continue;
      const parts = name.split("|");
      if (parts.length < 5) continue;
      const [project, owner, repo, branch, fork] = parts;
      total += n;
      const repoId = `${owner}/${repo}`;
      by_repo[repoId] = (by_repo[repoId] || 0) + n;
      by_branch[branch] = (by_branch[branch] || 0) + n;
      const forkFlag = fork === "1" ? "1" : "0";
      by_fork[forkFlag] = (by_fork[forkFlag] || 0) + n;
      breakdown.push({ project, owner, repo, branch, fork: forkFlag, count: n });
    }
  }

  const totalRaw = hasKv(env) ? await env.DOWNLOADS.get(KEYS.total) : null;
  const totalDirect = totalRaw == null ? null : parseInt(totalRaw, 10);
  const views = hasKv(env) ? parseInt((await env.DOWNLOADS.get(KEYS.views)) || "0", 10) || 0 : 0;
  const shown =
    totalDirect != null && Number.isFinite(totalDirect) && totalDirect >= 0 ? totalDirect : total;
  const viewsHuman = hasKv(env) ? parseInt((await env.DOWNLOADS.get(KEYS.views_human)) || "0", 10) || 0 : 0;
  const downloadsHuman = hasKv(env)
    ? parseInt((await env.DOWNLOADS.get(KEYS.downloads_human)) || "0", 10) || 0
    : 0;
  const botManagementAvailable = request ? readBotManagement(request).available : false;
  const gh = github && hasKv(env) ? await githubStats(env) : null;

  return {
    project: PROJECT,
    version: VERSION,
    asset: DEFAULT_ASSET,
    counter: hasKv(env) ? "kv" : "kv_unbound",
    total: shown,
    views,
    downloads: shown,
    by_repo,
    by_branch,
    by_fork,
    breakdown,
    ...(gh
      ? {
          github: {
            stars: gh.stars || 0,
            forks: gh.forks || 0,
            watchers: gh.watchers || 0,
            release_download_count: gh.release_download_count || 0,
          },
        }
      : {}),
    ...shapeHumanBotFields({
      views,
      downloads: shown,
      views_human: viewsHuman,
      downloads_human: downloadsHuman,
      botManagementAvailable,
    }),
    note: "Key layout: project|owner|repo|branch|fork. Views are separate from downloads. A download is counted when the gzip is served.",
  };
}

function installScript() {
  return `#!/usr/bin/env bash
# AZCL one-click install. Counted download is GET /download on this Worker.
set -euo pipefail
HOST="${HOST}"
ASSET="${DEFAULT_ASSET}"
SRC="\${AZCL_SRC:-\$HOME/azcl}"
mkdir -p "\$SRC"
cd "\$SRC"
echo "Downloading \${ASSET} from \${HOST}/download"
curl -fsSL -A 'Mozilla/5.0' "\${HOST}/download?asset=\${ASSET}" -o "\${ASSET}"
tar -xzf "\${ASSET}"
cd "azcl-${VERSION}"
if ! command -v node >/dev/null 2>&1; then
  echo "AZCL needs Node.js 22 or newer (node:sqlite)."
  exit 1
fi
if ! node -e 'const maj=Number(process.versions.node.split(".")[0]); if(!(maj>=22)) process.exit(1)'; then
  echo "AZCL needs Node.js 22 or newer (node:sqlite). Current: $(node -v)"
  exit 1
fi
npm install
npm run build
echo
echo "AZCL ${VERSION} is unpacked in $(pwd)"
echo "Vault data defaults to ~/.azcl (override with AZCL_HOME). This folder is the program."
echo "First import:  node dist/cli.js init"
echo "Local UI:      node dist/cli.js serve"
echo "Then open http://127.0.0.1:7733"
echo "Agent door:    node dist/cli.js mcp"
echo "Author: Aziel Eliab."
`;
}

async function assetByteLength(env, request, asset) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") return null;
  const assetUrl = new URL("/" + asset, request.url);
  const assetRes = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  if (!assetRes.ok) return null;
  const len = assetRes.headers.get("Content-Length") || assetRes.headers.get("content-length");
  if (len && Number(len) > 0) {
    try {
      assetRes.body?.cancel?.();
    } catch {
      /* ignore */
    }
    return Number(len);
  }
  const buf = await assetRes.arrayBuffer();
  return buf.byteLength;
}

async function serveAsset(request, env, asset, { head = false } = {}) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return json({ error: "assets binding missing", asset }, 500);
  }
  const assetUrl = new URL("/" + asset, request.url);
  const assetRes = await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }));
  if (!assetRes.ok) {
    return json({ error: "asset not hosted", asset, status: assetRes.status }, 404);
  }
  const headers = new Headers();
  headers.set("Content-Type", "application/gzip");
  headers.set("Content-Disposition", `attachment; filename="${asset}"`);
  headers.set("Cache-Control", "private, no-store");
  const len = assetRes.headers.get("Content-Length") || assetRes.headers.get("content-length");
  if (len) headers.set("Content-Length", len);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  if (head) {
    try {
      assetRes.body?.cancel?.();
    } catch {
      /* ignore */
    }
    return new Response(null, { status: 200, headers });
  }
  return new Response(assetRes.body, { status: 200, headers });
}

async function homeResponse(request, env) {
  await incrementViews(env, request);
  const stats = await collectStats(env, request, { github: false });
  const bytes = await assetByteLength(env, request, DEFAULT_ASSET);
  const html = renderHome({ downloads: stats.downloads, bytes });
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      ...corsHeaders(),
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if ((url.pathname === "/install.sh" || url.pathname === "/install.sh/") && request.method === "GET") {
      return new Response(installScript(), {
        status: 200,
        headers: {
          "Content-Type": "text/x-shellscript; charset=utf-8",
          "Cache-Control": "private, no-store",
          ...corsHeaders(),
        },
      });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return homeResponse(request, env);
    }

    if (url.pathname === "/count" && request.method === "GET") {
      const stats = await collectStats(env, request, { github: false });
      return json(
        shapeCountBody({
          project: PROJECT,
          views: stats.views || 0,
          downloads: stats.downloads || 0,
          total: stats.total || 0,
          views_human: stats.views_human,
          downloads_human: stats.downloads_human,
          botManagementAvailable: readBotManagement(request).available,
        }),
      );
    }

    if (url.pathname === "/stats" && request.method === "GET") {
      return json(await collectStats(env, request, { github: true }));
    }

    if (url.pathname === "/event" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "JSON body required" }, 400);
      }
      const dims = parseDims(body || {});
      const result = await incrementDownload(env, dims, request);
      return json({
        ok: true,
        counted: result.counted,
        key: kvKey(dims),
        count: result.count,
        owner: dims.owner,
        repo: dims.repo,
        branch: dims.branch,
        fork: dims.fork,
        asset: dims.asset || null,
      });
    }

    if (
      (url.pathname === "/download" || url.pathname.startsWith("/download/") || url.pathname === "/go") &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const dims = parseDims(url.searchParams);
      let raw = dims.asset;
      if (!raw && url.pathname.startsWith("/download/")) {
        raw = decodeURIComponent(url.pathname.slice("/download/".length));
      }
      const asset = resolveAsset(raw);
      if (!asset) {
        return json({ error: "unknown asset", asset: raw || null }, 404);
      }
      if (!env.ASSETS) {
        return json({ error: "assets binding missing", asset }, 500);
      }
      const probe = await env.ASSETS.fetch(new Request(new URL("/" + asset, request.url), { method: "GET" }));
      if (!probe.ok) {
        return json({ error: "asset not hosted", asset, status: probe.status }, 404);
      }
      try {
        probe.body?.cancel?.();
      } catch {
        /* ignore */
      }
      if (request.method === "GET") await incrementDownload(env, dims, request);
      return serveAsset(request, env, asset, { head: request.method === "HEAD" });
    }

    return json({ error: "not found", path: url.pathname }, 404);
  },
};
