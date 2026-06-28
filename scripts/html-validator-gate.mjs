#!/usr/bin/env node
// Re-proving gate: Nu HTML Checker (vnu) errors over the BUILT pages. Feeds the
// conformance criterion `html.validator-clean` (the kit's `htmlValidator`
// evidence: { errors }).
//
// HEADLESS, BUILD-ORIENTED: vnu is the reference HTML conformance checker, run as
// a self-contained Java jar (the `vnu-jar` package) — no browser, no network. It
// validates the rendered markup against the HTML Living Standard.
//
// Re-proven on every build, BLOCKS on regression: the committed evidence in
// data/conformance-evidence.json (`evidence.htmlValidator.errors`) must not be
// exceeded by a fresh run over dist/.
//
//   node scripts/html-validator-gate.mjs            # measure + print
//   node scripts/html-validator-gate.mjs --check    # measure + block if reality > committed
//
// Requires a JRE on PATH (CI: actions/setup-java; the jar ships with `vnu-jar`).

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, process.env.DIST || "dist");
const CHECK = process.argv.includes("--check");
const jar = String(require("vnu-jar"));

async function htmlFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await htmlFiles(p));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

const files = await htmlFiles(distDir);
// vnu writes its JSON report to stderr; --errors-only suppresses warnings/info.
const res = spawnSync(
  "java",
  ["-jar", jar, "--errors-only", "--format", "json", ...files],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);
if (res.error) {
  console.error(`✗ html-validator-gate: cannot run vnu (${res.error.message}). Is a JRE on PATH?`);
  process.exit(1);
}

const messages = JSON.parse(res.stderr || '{"messages":[]}').messages || [];
const errs = messages.filter((m) => m.type === "error");
const measured = errs.length;

const contract = JSON.parse(
  await readFile(join(root, "data", "conformance-evidence.json"), "utf8"),
);
const committed = contract.evidence?.htmlValidator?.errors ?? 0;

const summary =
  `html-validator-gate: ${measured} Nu HTML Checker error(s) over ${files.length} built page(s) · committed ${committed}`;

if (CHECK && measured > committed) {
  console.error(`✗ ${summary}`);
  for (const e of errs.slice(0, 20)) {
    console.error(`  ${relative(distDir, (e.url || "").replace(/^file:/, ""))} L${e.lastLine}: ${e.message}`);
  }
  process.exit(1);
}

console.log(`✓ ${summary}`);
