# AZCL download tracker

Worker name: `azcl-download-tracker`.

Intended route after a teammate deploys it (this repo does not deploy):

https://azcl-download-tracker.vibelock.workers.dev/

`GET /` is the landing. `GET /download` returns `public/azcl-0.1.0.tar.gz` with HTTP 200 and counts the download. `GET /count` returns `{project, views, downloads, total}`. Counts are stored per `project|owner|repo|branch|fork`, so other branches and forks that hit this Worker are included. `POST /event` lets a fork report a download.

KV binding: `DOWNLOADS`. Create a new namespace `AZCL_DOWNLOADS` and put its id in `wrangler.toml`. Do not reuse another product's namespace. The placeholder id is there so a deploy without that step fails.

There is no GitHub release asset yet. The gzip in `public/` is the package built from this repo (`scripts/pack-release.mjs`).

Rebuild it when the client source changes:

```bash
node scripts/pack-release.mjs
```

Author: Aziel Eliab.
