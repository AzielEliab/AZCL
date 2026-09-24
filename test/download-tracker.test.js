import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import worker, { DEFAULT_ASSET, PROJECT, parseDims, resolveAsset } from "../workers/download-tracker/src/index.js";
import { THEME, VERSION } from "../workers/download-tracker/src/home.js";
import { invariantHolds } from "../workers/download-tracker/src/stats-shape.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetPath = path.join(root, "workers/download-tracker/public", DEFAULT_ASSET);
const assetBytes = readFileSync(assetPath);

function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    },
    async list() {
      return { keys: [...map.keys()].map((name) => ({ name })), list_complete: true };
    },
    map,
  };
}

function env() {
  return {
    DOWNLOADS: memoryKv(),
    ASSETS: {
      async fetch() {
        return new Response(assetBytes, {
          status: 200,
          headers: { "content-length": String(assetBytes.length) },
        });
      },
    },
  };
}

function request(pathname, { method = "GET", headers = {}, body } = {}) {
  return new Request(`https://azcl-download-tracker.vibelock.workers.dev${pathname}`, {
    method,
    headers: { "user-agent": "Mozilla/5.0", ...headers },
    body,
  });
}

function contrast(a, b) {
  const lum = (hex) => {
    const c = hex.slice(1).match(/../g).map((h) => {
      const v = parseInt(h, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const L1 = lum(a);
  const L2 = lum(b);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

test("package tarball is the repo client at package.json version", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.version, VERSION);
  assert.equal(DEFAULT_ASSET, `azcl-${pkg.version}.tar.gz`);
  assert.equal(assetBytes[0], 0x1f);
  assert.equal(assetBytes[1], 0x8b);
  const listing = execFileSync("tar", ["-tzf", assetPath], { encoding: "utf8" });
  assert.match(listing, new RegExp(`^azcl-${pkg.version}/package.json$`, "m"));
  assert.match(listing, new RegExp(`^azcl-${pkg.version}/src/cli.ts$`, "m"));
  assert.match(listing, new RegExp(`^azcl-${pkg.version}/public/index.html$`, "m"));
  assert.doesNotMatch(listing, /\.tar\.gz/);
  assert.doesNotMatch(listing, /download-tracker\.test\.js/);
  const packed = execFileSync("tar", ["-xOzf", assetPath, `azcl-${pkg.version}/package.json`], { encoding: "utf8" });
  assert.equal(JSON.parse(packed).version, pkg.version);
});

test("landing names the product and points Download at /download", async () => {
  const res = await worker.fetch(request("/"), env());
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<h1>AZCL<\/h1>/);
  assert.match(html, /href="\/download"/);
  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /:focus-visible/);
  assert.match(html, new RegExp(VERSION));
  assert.match(html, /src="\/preview.png"/);
  assert.doesNotMatch(html, /this is not/i);
  const preview = readFileSync(path.join(root, "workers/download-tracker/public/preview.png"));
  assert.equal(preview[0], 0x89);
  assert.equal(preview[1], 0x50);
});

test("theme pairs meet WCAG AA contrast", () => {
  for (const theme of Object.values(THEME)) {
    assert.ok(contrast(theme.bg, theme.ink) >= 4.5);
    assert.ok(contrast(theme.bg, theme.muted) >= 4.5);
    assert.ok(contrast(theme.buttonBg, theme.buttonInk) >= 4.5);
    assert.ok(contrast(theme.bg, theme.link) >= 4.5);
    assert.ok(contrast(theme.panel, theme.muted) >= 4.5);
  }
});

test("/download returns the gzip and counts branch and fork separately", async () => {
  const box = env();
  const human = { "user-agent": "Mozilla/5.0" };
  const bot = { "user-agent": "curl/8.0" };

  const a = await worker.fetch(request("/download?branch=main", { headers: human }), box);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get("content-type"), "application/gzip");
  assert.match(a.headers.get("content-disposition"), /azcl-0\.1\.0\.tar\.gz/);
  assert.equal(a.headers.get("cache-control"), "private, no-store");
  const bytes = new Uint8Array(await a.arrayBuffer());
  assert.equal(bytes.length, assetBytes.length);
  assert.equal(bytes[0], 0x1f);

  const b = await worker.fetch(request("/download?branch=dev", { headers: human }), box);
  assert.equal(b.status, 200);
  await b.arrayBuffer();

  const c = await worker.fetch(request("/download?owner=other&repo=AZCL&branch=main", { headers: bot }), box);
  assert.equal(c.status, 200);
  await c.arrayBuffer();

  const head = await worker.fetch(request("/download", { method: "HEAD", headers: human }), box);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const page = await worker.fetch(request("/", { headers: human }), box);
  assert.equal(page.status, 200);
  await page.text();

  const countRes = await worker.fetch(request("/count"), box);
  const count = await countRes.json();
  assert.equal(count.project, PROJECT);
  assert.equal(count.downloads, 3);
  assert.equal(count.total, 3);
  assert.equal(count.views, 1);
  assert.equal(invariantHolds(count), true);

  const statsRes = await worker.fetch(request("/stats"), box);
  const stats = await statsRes.json();
  assert.equal(stats.by_branch.main, 2);
  assert.equal(stats.by_branch.dev, 1);
  assert.equal(stats.by_fork["0"], 2);
  assert.equal(stats.by_fork["1"], 1);
  assert.equal(stats.by_repo["AzielEliab/AZCL"], 2);
  assert.equal(stats.by_repo["other/AZCL"], 1);
  assert.equal(invariantHolds(stats), true);
  assert.equal(stats.downloads_human + stats.downloads_bot, stats.downloads);
});

test("unknown assets and path tricks are not counted", async () => {
  const box = env();
  const bad = await worker.fetch(request("/download?asset=../../etc/passwd"), box);
  assert.equal(bad.status, 404);
  const nested = await worker.fetch(request("/download/azcl-9.9.9.tar.gz"), box);
  assert.equal(nested.status, 404);
  const count = await (await worker.fetch(request("/count"), box)).json();
  assert.equal(count.downloads, 0);
  assert.equal(count.views, 0);
});

test("POST /event records a fork download without serving a file", async () => {
  const box = env();
  const res = await worker.fetch(
    request("/event", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
      body: JSON.stringify({ owner: "forker", repo: "AZCL", branch: "patch-1", fork: "1" }),
    }),
    box,
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fork, "1");
  assert.equal(body.key, "azcl|forker|AZCL|patch-1|1");
  const count = await (await worker.fetch(request("/count"), box)).json();
  assert.equal(count.downloads, 1);
});

test("install.sh curls the counted download and does not increment by itself", async () => {
  const box = env();
  const res = await worker.fetch(request("/install.sh"), box);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /ASSET="azcl-0\.1\.0\.tar\.gz"/);
  assert.match(text, /\/download\?asset=\$\{ASSET\}/);
  assert.match(text, /node dist\/cli\.js init/);
  const count = await (await worker.fetch(request("/count"), box)).json();
  assert.equal(count.downloads, 0);
  assert.equal(count.views, 0);
});

test("parseDims marks a different owner as a fork", () => {
  const dims = parseDims({ owner: "Ada", repo: "AZCL", branch: "feature" });
  assert.equal(dims.fork, "1");
  assert.equal(resolveAsset(""), DEFAULT_ASSET);
  assert.equal(resolveAsset("../etc/passwd"), null);
  assert.equal(resolveAsset(DEFAULT_ASSET), DEFAULT_ASSET);
});
