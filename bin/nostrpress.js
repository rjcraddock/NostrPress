#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const cliPath = path.resolve(packageRoot, "src", "cli.ts");
const tsxBin = process.platform === "win32" ? "tsx.cmd" : "tsx";
const binPath = path.join(packageRoot, "node_modules", ".bin");
const env = {
  ...process.env,
  PATH: `${binPath}${path.delimiter}${process.env.PATH || ""}`
};

const result = spawnSync(tsxBin, [cliPath, ...process.argv.slice(2)], {
  stdio: "inherit",
  env
});

process.exit(result.status ?? 1);
