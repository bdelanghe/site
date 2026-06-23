#!/usr/bin/env node
// Grounding gate — the claim/grounding check, kept *separate* from the prose gate and
// independent of string-audit's audit.mjs (which pulls JSR deps). It's the same rule
// string-audit applies to `claim` symbols, reimplemented here over our derived catalog:
// a string carrying a stat must be backed by the fact registry (data/audit/grounding.json),
// or it's flagged. "Flag, never rewrite as fact." This is the "no unbacked metric ships"
// enforcement — deterministic, offline, dependency-free.
//
// (Longer-term this belongs upstream in prose.mjs as a grounding-aware check; until then
// it lives here. See data/audit/README.md.)
//
//   node check-grounding.mjs            report-only (exit 0)
//   node check-grounding.mjs --strict   exit 1 if any claim is ungrounded
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes("--strict");
const readJson = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// Same shape string-audit's `claim` audit uses: a recognized stat token, and whether any
// grounded fact appears in the value.
const STAT = /\b\d[\d,. ]*\s*(%|stars?|customers?|reviews?|bpm|days?|x)\b/i;

async function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}

async function main() {
  const [catalog, grounding] = await Promise.all([
    readJson("data/audit/catalog.json"),
    readJson("data/audit/grounding.json").catch(() => []),
  ]);

  const flags = [];
  let claims = 0;
  for (const [sym, { type, value }] of Object.entries(catalog)) {
    if (type !== "claim") continue;
    claims++;
    const low = value.toLowerCase();
    const grounded = grounding.some((g) => low.includes(g.toLowerCase()));
    if (grounded) continue;
    const stat = value.match(STAT);
    flags.push({
      sym,
      msg: stat
        ? `ungrounded stat "${stat[0].trim()}" — not in grounding registry; flag, never ship as fact`
        : `claim asserts nothing grounded — verify against the registry`,
    });
  }

  const L = ["# Grounding gate (claims)\n"];
  L.push(`${claims} claim(s) · ${flags.length} ungrounded\n`);
  if (!flags.length) L.push("✓ every claim is backed by the fact registry.");
  for (const f of flags) L.push(`- ✗ \`${f.sym}\` — ${f.msg}`);
  const md = L.join("\n");
  console.log(md);
  await summary(md);

  if (strict && flags.length) {
    console.error(`\ncheck-grounding: ${flags.length} ungrounded claim(s) under --strict → failing.`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(strict ? 1 : 0);
  },
);
