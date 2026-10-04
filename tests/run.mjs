// Bundles each tests/*.test.ts with esbuild — swapping the "obsidian" module,
// which only exists inside the app, for tests/obsidian.ts — and runs the
// bundles with Node's built-in test runner.
//
// The suite runs twice, once in a timezone east of UTC and once west of it:
// date bugs tend to hide on one side, and the plugin's users are on both.
import { build } from "esbuild";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, ".build");
const only = process.argv.slice(2);

const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.ts"))
  .filter((f) => !only.length || only.some((o) => f.includes(o)));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: files.map((f) => path.join(here, f)),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outdir: out,
  outExtension: { ".js": ".mjs" },
  alias: { obsidian: path.join(here, "obsidian.ts") },
  logLevel: "warning",
});

let failed = false;
for (const tz of ["Asia/Tehran", "America/New_York"]) {
  console.log(`\n# TZ=${tz}`);
  const result = spawnSync(
    process.execPath,
    ["--test", ...files.map((f) => path.join(out, f.replace(/\.ts$/, ".mjs")))],
    { stdio: "inherit", env: { ...process.env, TZ: tz } }
  );
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
