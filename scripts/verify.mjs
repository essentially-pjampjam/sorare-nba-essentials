#!/usr/bin/env node
// Release verification for pjampjam's Sorare NBA Essentials.
// Default / --fast: read-only invariant checks (no build, no file writes).
// --full: invariants, then `npm run check` (typecheck + vitest + vite build).
// Fails closed: any failed check sets exit code 1.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = new Set(process.argv.slice(2));

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: node scripts/verify.mjs [--fast | --full | --help]

  (default), --fast   Read-only invariant checks (versions, network isolation,
                      calculator purity, rate limit, em-dash hygiene, 404 routes).
  --full              Invariants, then npm run check (typecheck, vitest, build).
  --help              Show this help.`);
  process.exit(0);
}

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

function walk(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx|css|html|md)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// 1. Version parity: package.json, public/manifest.json, PROJECT_STATE.md (local, gitignored).
const pkg = JSON.parse(read("package.json"));
const manifest = JSON.parse(read("public/manifest.json"));
const baseVersion = String(pkg.version).split("-")[0];
check(
  "package.json and manifest.json versions match",
  manifest.version === baseVersion,
  `package.json ${pkg.version}, manifest.json ${manifest.version}`,
);
if (existsSync(join(ROOT, "PROJECT_STATE.md"))) {
  const state = read("PROJECT_STATE.md");
  const status = state.split("\n").find((l) => l.startsWith("Status:")) ?? "";
  check("PROJECT_STATE.md status names the current version", status.includes(pkg.version), status.trim());
} else {
  console.log("note: PROJECT_STATE.md not found (it is gitignored); skipped its version check");
}

// 2. Network isolation: no Sorare/ESPN calls from the side panel or content scripts.
const srcFiles = walk("src").filter((f) => !/\.test\.tsx?$/.test(f));
const uiFiles = srcFiles.filter((f) => /src[\\/](sidepanel|content)[\\/]/.test(f));
const netViolations = uiFiles.filter((f) =>
  /https:\/\/api\.sorare\.com|api\.sorare\.com\/graphql|site\.api\.espn\.com|\bfetch\s*\(/.test(read(f)),
);
check("Network isolation (api.sorare.com only from src/background)", netViolations.length === 0, netViolations.join(", "));

// 3. Calculator purity: src/calculators has no chrome / fetch / window / document.
const calcViolations = srcFiles
  .filter((f) => /src[\\/]calculators[\\/]/.test(f))
  .filter((f) => /\bchrome\.|\bfetch\s*\(|\bwindow\.|\bdocument\./.test(read(f)));
check("Pure calculators (no chrome., fetch, window., document.)", calcViolations.length === 0, calcViolations.join(", "));

// 4. Rate limit cap (<= 120 req/min under Sorare's 150).
const rateMatch = read("src/shared/constants.ts").match(/MAX_REQUESTS_PER_MINUTE\s*=\s*(\d+)/);
check("MAX_REQUESTS_PER_MINUTE <= 120", rateMatch && Number(rateMatch[1]) <= 120, rateMatch?.[1] ?? "missing");

// 5. Known 404 routes never hardcoded.
const routeViolations = srcFiles.filter((f) => {
  const t = read(f);
  return t.includes("https://sorare.com/nba/arena") || t.includes("https://sorare.com/nba/set");
});
check("No prohibited 404 routes (/nba/arena, /nba/set)", routeViolations.length === 0, routeViolations.join(", "));

// 6. Text hygiene: no em-dash (U+2014) in src or workflow docs.
const docFiles = ["CHANGELOG.md", "INPUT_NEEDED.md", "TESTING.md", "ROADMAP.md", "README.md", ".agents/skills/ship-update/SKILL.md"]
  .filter((f) => existsSync(join(ROOT, f)));
const dashFiles = [...walk("src"), ...docFiles].filter((f) => read(f).includes("—"));
check("No em-dash (U+2014) in src and workflow docs", dashFiles.length === 0, dashFiles.join(", "));

// 7. Required permissions.
for (const perm of ["sidePanel", "storage", "alarms", "notifications", "scripting"]) {
  check(`manifest permission "${perm}"`, (manifest.permissions ?? []).includes(perm));
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed += 1;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail && !r.ok ? `  (${r.detail})` : ""}`);
}

if (failed === 0 && args.has("--full")) {
  console.log("\nRunning npm run check (typecheck, vitest, build)...");
  const run = spawnSync("npm", ["run", "check"], { cwd: ROOT, stdio: "inherit", shell: true });
  if (run.status !== 0) {
    console.log("FAIL  npm run check");
    failed += 1;
  } else {
    console.log("PASS  npm run check");
  }
}

console.log(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`} (${relative(process.cwd(), ROOT) || "."})`);
if (failed > 0) process.exitCode = 1;
