#!/usr/bin/env node
// Re-proving gate: Baseline availability of the CSS features the site SHIPS.
// Feeds the conformance criterion `compatibility.baseline` (the kit's `baseline`
// evidence: { status, fallbackTested }).
//
// HEADLESS, BUILD-ORIENTED: stylelint-plugin-use-baseline maps the built CSS to
// web-features Baseline data — no browser, no network. The site-wide status is the
// WORST feature used:
//   • 0 features below "widely"            -> "widely"
//   • some below "widely" but none below "newly" -> "newly"
//   • any feature below "newly"            -> "limited"
//
// HONEST, NOT ASPIRATIONAL: the gate asserts the MEASURED status, whatever it is.
// It blocks on ANY drift from the committed evidence (status must match reality
// exactly), so the declaration can neither overclaim ("widely" when it isn't) nor
// silently go stale after a CSS fix improves it.
//
//   node scripts/baseline-gate.mjs            # measure + print
//   node scripts/baseline-gate.mjs --check    # measure + block if status != committed

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import stylelint from "stylelint";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distGlob = join(root, process.env.DIST || "dist", "**/*.css");
const CHECK = process.argv.includes("--check");

async function violations(available) {
  const res = await stylelint.lint({
    files: distGlob,
    config: {
      plugins: ["stylelint-plugin-use-baseline"],
      rules: { "plugin/use-baseline": [true, { available }] },
    },
  });
  const feats = [];
  for (const r of res.results) {
    for (const w of r.warnings) feats.push(w.text.replace(/\s+plugin\/use-baseline$/, ""));
  }
  return feats;
}

const belowWidely = await violations("widely");
let status = "widely";
let offenders = [];
if (belowWidely.length > 0) {
  const belowNewly = await violations("newly");
  status = belowNewly.length > 0 ? "limited" : "newly";
  offenders = belowWidely;
}

const contract = JSON.parse(
  await readFile(join(root, "data", "conformance-evidence.json"), "utf8"),
);
const committed = contract.evidence?.baseline?.status ?? "widely";

const summary =
  `baseline-gate: shipped CSS is Baseline "${status}" ` +
  `(${offenders.length} feature(s) below widely) · committed "${committed}"`;

if (CHECK && status !== committed) {
  console.error(`✗ ${summary}`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    `  measured status "${status}" != committed "${committed}" — ` +
      `update evidence.baseline.status (a CSS fix may have improved it, or a regression worsened it).`,
  );
  process.exit(1);
}

console.log(`✓ ${summary}`);
if (offenders.length > 0) for (const o of offenders) console.log(`  · ${o}`);
