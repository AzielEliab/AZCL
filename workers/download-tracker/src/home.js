/**
 * AZCL download landing.
 * One package (Node.js 22+). No per-OS builds exist in this repo.
 * Author: Aziel Eliab.
 */

export const THEME = {
  light: {
    bg: "#fbf7f1",
    ink: "#1b1814",
    muted: "#4a453c",
    buttonBg: "#1b1814",
    buttonInk: "#fbf7f1",
    link: "#0c3d6e",
    panel: "#fffdf9",
    line: "#d5ccbc",
    focus: "#0c3d6e",
  },
  dark: {
    bg: "#100e0c",
    ink: "#f7f2e8",
    muted: "#cfc6b6",
    buttonBg: "#f0d48a",
    buttonInk: "#1a1408",
    link: "#f0d48a",
    panel: "#1a1814",
    line: "#4a4336",
    focus: "#ffe7a3",
  },
};

export const HOST = "https://azcl-download-tracker.vibelock.workers.dev";
export const VERSION = "0.1.0";

function cssVars(theme) {
  return `--bg:${theme.bg};--ink:${theme.ink};--muted:${theme.muted};--button-bg:${theme.buttonBg};--button-ink:${theme.buttonInk};--link:${theme.link};--panel:${theme.panel};--line:${theme.line};--focus:${theme.focus};`;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderHome({ downloads = 0, bytes = null } = {}) {
  const count = Number.isFinite(downloads) && downloads > 0 ? Math.floor(downloads) : 0;
  const size = formatBytes(bytes);
  const sizeBit = size ? ` · ${size}` : "";
  const light = THEME.light;
  const dark = THEME.dark;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>AZCL — Aziel Corpus Library</title>
<meta name="description" content="AZCL is a local vault for the Aziel Digital Library. First run imports the public shelf and verifies each file. Later syncs append. Aziel Eliab. Apache-2.0.">
<meta name="author" content="Aziel Eliab">
<link rel="canonical" href="${HOST}/">
<link rel="icon" type="image/png" href="/sigil.png">
<style>
  :root { color-scheme: light; ${cssVars(light)} }
  @media (prefers-color-scheme: dark) {
    :root { color-scheme: dark; ${cssVars(dark)} }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); }
  body {
    font: 1.0625rem/1.5 system-ui, "Segoe UI", sans-serif;
    min-height: 100vh;
  }
  a { color: var(--link); }
  a:hover { text-decoration-thickness: 2px; }
  .skip {
    position: absolute;
    left: 0.75rem;
    top: 0.75rem;
    transform: translateY(-160%);
    background: var(--button-bg);
    color: var(--button-ink);
    padding: 0.55rem 0.85rem;
    border-radius: 8px;
    z-index: 3;
    text-decoration: none;
    font-weight: 700;
  }
  .skip:focus { transform: none; }
  a:focus-visible, summary:focus-visible {
    outline: 3px solid var(--focus);
    outline-offset: 3px;
  }
  .wrap { max-width: 40rem; margin: 0 auto; padding: 1.25rem 1.15rem 3rem; }
  .sigil { width: 48px; height: auto; display: block; border-radius: 10px; }
  .eyebrow {
    margin: 0.85rem 0 0.15rem;
    color: var(--muted);
    font-size: 0.82rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  h1 { font-size: 2.6rem; line-height: 1.05; letter-spacing: -0.03em; margin: 0; }
  .lede { margin: 0.75rem 0 0; font-size: 1.15rem; max-width: 36rem; }
  .cta { margin: 1.35rem 0 0; }
  .download {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    max-width: 22rem;
    min-height: 3.4rem;
    padding: 0.85rem 1.4rem;
    border-radius: 999px;
    background: var(--button-bg);
    color: var(--button-ink);
    text-decoration: none;
    font-weight: 750;
    font-size: 1.15rem;
    border: 2px solid var(--button-bg);
  }
  .download:hover { filter: brightness(1.08); }
  .download:focus-visible { outline: 3px solid var(--focus); outline-offset: 3px; }
  .hint { margin: 0.7rem 0 0; color: var(--muted); font-size: 0.95rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.75rem; }
  .features { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.7rem; }
  .features li {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 0.9rem 1rem 1rem;
  }
  .features h3 { margin: 0 0 0.25rem; font-size: 1rem; }
  .features p { margin: 0; color: var(--muted); }
  code, pre {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.88rem;
  }
  pre {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 0.85rem 1rem;
    overflow-x: auto;
    color: var(--ink);
  }
  .preview {
    margin: 0.4rem 0 0;
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
    background: var(--panel);
  }
  .preview img { display: block; width: 100%; height: auto; }
  .preview figcaption { margin: 0; padding: 0.75rem 0.95rem 0.9rem; color: var(--muted); font-size: 0.92rem; }
  details { margin-top: 0.9rem; }
  summary { cursor: pointer; min-height: 2.75rem; display: flex; align-items: center; }
  .surface { margin: 0.4rem 0 0; color: var(--muted); }
  footer {
    margin-top: 2.4rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.92rem;
  }
  footer p { margin: 0.3rem 0; }
  @media (min-width: 800px) {
    .wrap { padding-top: 2.5rem; }
    h1 { font-size: 3.25rem; }
    .download { width: auto; min-width: 16rem; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { scroll-behavior: auto; }
  }
</style>
</head>
<body>
<a class="skip" href="#download">Skip to download</a>
<div class="wrap">
  <header class="hero">
    <img class="sigil" src="/sigil.png" width="48" height="34" alt="">
    <p class="eyebrow">Aziel Eliab</p>
    <h1>AZCL</h1>
    <p class="lede">Local vault for the Aziel Digital Library. First run imports the public shelf; later syncs append.</p>
    <div class="cta" id="download">
      <a class="download" href="/download">Download</a>
      <p class="hint">Version ${VERSION}${sizeBit}. Node.js 22 or newer. One package for Linux, macOS, and Windows.</p>
    </div>
    <details>
      <summary>Install from a terminal</summary>
      <pre><code>curl -fsSL ${HOST}/install.sh | bash</code></pre>
      <p class="surface">The script downloads this same package, then runs <code>npm install</code> and <code>npm run build</code>. Program files stay in the folder you choose. The vault defaults to <code>~/.azcl</code>.</p>
    </details>
  </header>
  <main>
    <section aria-labelledby="features-title">
      <h2 id="features-title">What you get</h2>
      <ul class="features">
        <li>
          <h3>Verified first import</h3>
          <p>Pulls the public packed library index, then each file and its hashchain metadata. Bytes are stored after the SHA-256 check matches.</p>
        </li>
        <li>
          <h3>Append-only sync</h3>
          <p>While online, sync adds new or changed records. Earlier objects and master rows stay in the vault.</p>
        </li>
        <li>
          <h3>Offline search</h3>
          <p>After import, search and browse use the local vault when the network is down.</p>
        </li>
        <li>
          <h3>Human UI and agent tools</h3>
          <p><code>azcl serve</code> opens the vault UI at <code>http://127.0.0.1:7733</code>. <code>azcl mcp</code> speaks stdio MCP. That same local server publishes <code>/openapi.json</code>.</p>
        </li>
      </ul>
    </section>
    <section aria-labelledby="preview-title">
      <h2 id="preview-title">Local vault</h2>
      <figure class="preview">
        <img src="/preview.png" alt="AZCL vault screen with search, sample library records, and hashchain tips." width="1280" height="800">
        <figcaption>The local UI from <code>azcl serve</code>. The rows in this picture are the sample records in the repository fixture.</figcaption>
      </figure>
    </section>
    <section aria-labelledby="local-title">
      <h2 id="local-title">After download</h2>
      <p class="surface">First import: <code>node dist/cli.js init</code></p>
      <p class="surface">Local UI: <code>node dist/cli.js serve</code></p>
      <p class="surface">Agent tools on this computer: <code>azcl_status</code>, <code>azcl_search</code>, <code>azcl_get</code>, <code>azcl_tips</code>, <code>azcl_ledger</code>, <code>azcl_sync</code>.</p>
    </section>
  </main>
  <footer>
    <p>AZCL ${VERSION} · Aziel Eliab · Apache-2.0</p>
    <p>Lamb Lens: Service, then Clarity, then Peace.</p>
    <p><a href="https://github.com/AzielEliab/AZCL">GitHub</a> · <a href="https://www.azielcorpuslibrary.net/">Aziel Digital Library</a> · <a href="/count">Download count</a></p>
    <p>Downloads counted on this Worker, including other branches and forks: ${count}.</p>
  </footer>
</div>
</body>
</html>`;
}
