import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "public");
const to = join(root, "dist", "public");
if (!existsSync(from)) process.exit(0);
mkdirSync(to, { recursive: true });
cpSync(from, to, { recursive: true });
