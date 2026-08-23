#!/usr/bin/env node
// npm v12 readiness — the install-script allowlist must match the lockfile.
//
// npm 12 turns `allowScripts` off by default: a dependency's preinstall/install/
// postinstall no longer runs unless package.json names it, VERSION-PINNED. This
// repo needs four of them to build at all — esbuild and workerd place platform
// binaries for the Workers toolchain, vnu-jar fetches the HTML validator, and
// fsevents is the native watcher on darwin.
//
// A version-pinned allowlist un-approves itself on every dependency bump, so the
// failure mode is a lockfile update that silently drops a build tool's script and
// only shows up as a broken build later. This gate makes that a red check on the
// PR that bumps it.
//
// WHY THE LOCKFILE IS THE SOURCE OF TRUTH, and not `npm approve-scripts`: that
// command reads the INSTALLED node_modules. Generating the allowlist here from a
// stale tree produced `sharp@0.34.5` (which the lockfile resolves to 0.35.2, and
// which declares no install script at all) and `workerd@1.20260617.1` (lockfile:
// 1.20260820.1) — two wrong entries out of four, in a file whose whole job is to
// be exact. The lockfile is what CI installs; it is what this compares against.
import { readFileSync, writeFileSync } from "node:fs";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8")).packages;
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const required = new Set(
  Object.entries(lock)
    .filter(([, v]) => v.hasInstallScript)
    .map(([path, v]) => `${path.split("node_modules/").pop()}@${v.version}`),
);
const allowed = new Set(Object.keys(pkg.allowScripts ?? {}));

const missing = [...required].filter((k) => !allowed.has(k)).sort();
const stale = [...allowed].filter((k) => !required.has(k)).sort();

// --write regenerates the block in place, textually, so the rest of package.json
// keeps its exact bytes — a JSON round-trip here rewrites unrelated lines (it
// un-escapes \\u2014 in the description, for one).
if (process.argv.includes("--write")) {
  const src = readFileSync("package.json", "utf8");
  const body = [...required].sort().map((e) => `    "${e}": true`).join(",\n");
  const block = `  "allowScripts": {\n${body}\n  }\n}\n`;
  const start = src.indexOf('  "allowScripts": {');
  const out =
    start === -1
      ? src.slice(0, src.lastIndexOf("\n}\n")) + ",\n" + block
      : src.slice(0, start) + block;
  writeFileSync("package.json", out);
  JSON.parse(readFileSync("package.json", "utf8"));
  console.log(`allow-scripts: wrote ${required.size} entr(ies) to package.json`);
  process.exit(0);
}

if (missing.length === 0 && stale.length === 0) {
  console.log(`allow-scripts: ${required.size} install script(s), allowlist exact`);
  process.exit(0);
}
for (const k of missing) {
  console.error(`allow-scripts: MISSING ${k} — its install script will be blocked under npm 12`);
}
for (const k of stale) {
  console.error(`allow-scripts: STALE   ${k} — no longer in the lockfile`);
}
console.error(
  "\nRegenerate from the lockfile (not from node_modules — see this file's header):\n" +
    "  node scripts/check-allow-scripts.mjs --write",
);
process.exit(1);
