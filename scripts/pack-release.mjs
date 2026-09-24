/**
 * Build workers/download-tracker/public/azcl-<version>.tar.gz
 * from the client source in this repo. Does not invent a version.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json version must be x.y.z, got ${version}`);
}

const name = `azcl-${version}`;
const stage = path.join(root, ".pack-stage");
const destRoot = path.join(stage, name);
rmSync(stage, { recursive: true, force: true });
mkdirSync(destRoot, { recursive: true });

const include = [
  "package.json",
  "package-lock.json",
  "README.md",
  "LICENSE",
  "NOTICE",
  "tsconfig.json",
  ".gitignore",
  "src",
  "public",
  "scripts",
  "docs",
  "dossiers",
  "test",
];

for (const rel of include) {
  cpSync(path.join(root, rel), path.join(destRoot, rel), { recursive: true });
}

// The Worker test imports workers/, which is not part of the client package.
rmSync(path.join(destRoot, "test/download-tracker.test.js"), { force: true });

const outDir = path.join(root, "workers/download-tracker/public");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `${name}.tar.gz`);
rmSync(out, { force: true });
execFileSync("tar", ["-czf", out, "-C", stage, name], { stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });

const size = statSync(out).size;
if (size < 1000) throw new Error(`tarball too small: ${size}`);
process.stdout.write(`${out} ${size} bytes\n`);
