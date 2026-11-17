// Runs every suite in order against E2E_BASE_URL (default http://localhost:3100).
// Start the app first (`corepack pnpm build`, then `corepack pnpm --filter @certibuy/web start -p 3100`),
// then run `corepack pnpm e2e` from the repository root. Pass suite numbers to run a subset:
// `corepack pnpm e2e 03 07`.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const suites = readdirSync(here)
  .filter((f) => /^\d\d-.*\.mjs$/.test(f))
  .filter((f) => only.length === 0 || only.some((n) => f.startsWith(n)))
  .sort();

const summary = [];
for (const file of suites) {
  console.log(`\n===== ${file}`);
  const r = spawnSync(process.execPath, [join(here, file)], { stdio: "inherit", env: process.env });
  summary.push([file, r.status === 0]);
}
console.log("\n===== summary");
for (const [file, ok] of summary) console.log(`${ok ? "PASS" : "FAIL"}  ${file}`);
process.exitCode = summary.every(([, ok]) => ok) ? 0 : 1;
