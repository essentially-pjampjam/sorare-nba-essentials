#!/usr/bin/env node
// Read-only release helper: shows where a release stands and what to update next.
// Never writes files, never commits, never pushes.
//   node scripts/ship-helper.mjs next     what to do next for this release (default)
//   node scripts/ship-helper.mjs status   versions, branch, uncommitted files
//   node scripts/ship-helper.mjs --help
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const cmd = process.argv[2] ?? "next";

if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  console.log(`Usage: node scripts/ship-helper.mjs [next | status | --help]

  next     Release checklist with what is still missing (default).
  status   Versions, git branch and uncommitted files.
  --help   Show this help.

Read-only: it never edits files, commits or pushes.`);
  process.exit(0);
}

const read = (rel) => (existsSync(join(ROOT, rel)) ? readFileSync(join(ROOT, rel), "utf8") : null);
const git = (...a) => {
  const r = spawnSync("git", a, { cwd: ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
};

const pkg = JSON.parse(read("package.json") ?? "{}");
const manifest = JSON.parse(read("public/manifest.json") ?? "{}");
const version = String(pkg.version ?? "?");
const base = version.split("-")[0];
const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "?";
const dirty = git("status", "--porcelain").split("\n").filter(Boolean);

function section(title, lines) {
  console.log(`\n== ${title} ==`);
  for (const l of lines) console.log(`  ${l}`);
}

section("Status", [
  `package.json          ${version}`,
  `manifest.json         ${manifest.version ?? "?"} (version_name ${manifest.version_name ?? "-"})`,
  `branch                ${branch}${branch === "main" ? "  (do not commit releases directly to main)" : ""}`,
  `uncommitted files     ${dirty.length}`,
]);
if (cmd === "status") {
  for (const l of dirty.slice(0, 30)) console.log(`    ${l}`);
  process.exit(0);
}

const has = (rel, needle) => (read(rel) ?? "").includes(needle);
const items = [
  ["package.json version bumped", true],
  ["public/manifest.json version matches", manifest.version === base],
  ["PROJECT_STATE.md status names the version", (read("PROJECT_STATE.md") ?? "").split("\n").some((l) => l.startsWith("Status:") && l.includes(version))],
  ["CHANGELOG.md has an entry", has("CHANGELOG.md", base)],
  ["WhatsNewModal.tsx has highlights", has("src/sidepanel/components/WhatsNewModal.tsx", `version: "${version}"`) || has("src/sidepanel/components/WhatsNewModal.tsx", `version: "${base}"`)],
  ["TESTING.md lists live tests", has("TESTING.md", base)],
  ["INPUT_NEEDED.md reviewed (open Decisions)", existsSync(join(ROOT, "INPUT_NEEDED.md"))],
];
section(
  `Release checklist for ${version}`,
  items.map(([label, ok]) => `[${ok ? "x" : " "}] ${label}`),
);

const decisions = (read("INPUT_NEEDED.md") ?? "").split(/^## /m).find((s) => /^Decisions/i.test(s)) ?? "";
const open = decisions.split("\n").filter((l) => /^\s*-\s+/.test(l)).slice(0, 8);
if (open.length) section("Open decisions (INPUT_NEEDED.md)", open.map((l) => l.trim()));

const missing = items.filter(([, ok]) => !ok).map(([label]) => label);
section("Next steps", [
  ...(missing.length ? missing.map((m) => `- ${m}`) : ["- Checklist complete."]),
  "- Run: node scripts/verify.mjs --full",
  "- Manual: reload the extension in chrome://extensions and run the TESTING.md live tests.",
  "- Commit on the release branch; merge to main only after the live test passes.",
]);
