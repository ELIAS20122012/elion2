#!/usr/bin/env node
// Thin launcher: runs the TypeScript CLI with Node's built-in type stripping.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const r = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
