#!/usr/bin/env node
// Prose gate — deterministic copy hygiene via the shared, owned auditor's prose checks.
//
// Imports prose.mjs directly from the pinned `string-audit/` submodule (v0.3.0+) and runs
// it over our shipped copy (the typed-symbol catalog). prose.mjs's only runtime deps are
// two public-npm packages (an-array-of-english-words, write-good) installed in this repo's
// node_modules — so this runs locally, egress-free. It deliberately does NOT touch
// audit.mjs / store.mjs, which pull JSR deps (cas / anchored-chain) that a restrictive
// network policy blocks. The grounding (claim) check lives in its own gate
// (check-grounding.mjs); see data/audit/README.md.
//
// Checks: aiIsms (AI-tell cadences/lexicon), overclaims (absolute coverage language),
// proofread (mechanical defects), readability (long/dense). Each finding carries a
// first-class severity: error | warn | suggestion.
//
//   node check-prose.mjs            report-only (exit 0) — findings to the run summary
//   node check-prose.mjs --strict   exit 1 on a blocking error-level finding
//
// Attested overclaims: an `overclaim` is an honesty *prompt*, not always a defect — a
// coverage claim with a linked source is defensible. data/audit/attested-claims.json is
// the allowlist of confirmed coverage phrases; matching overclaims are demoted to a
// report-only "attested" note so --strict blocks only genuine defects (chatbot artifacts,
// placeholders, un-attested absolutes). Same "attest, don't suppress" model as grounding.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aiIsms, overclaims, proofread, readability } from "./string-audit/prose.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes("--strict");
const readJson = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

const GLYPH = { error: "✗", warn: "⚠", suggestion: "·" };
const ORDER = { error: 0, warn: 1, suggestion: 2 };

async function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}

async function main() {
  const [catalog, attested] = await Promise.all([
    readJson("data/audit/catalog.json"),
    readJson("data/audit/attested-claims.json").catch(() => []),
  ]);
  const isAttested = (msg) => attested.some((p) => msg.toLowerCase().includes(p.toLowerCase()));

  const findings = [];
  let attestedCount = 0;
  for (const [sym, { type, value }] of Object.entries(catalog)) {
    for (const f of [...aiIsms(value), ...overclaims(value), ...proofread(value), ...readability(value, type)]) {
      // Demote an attested coverage claim out of the blocking error tier.
      if (f.level === "error" && /^overclaim:/.test(f.msg) && isAttested(f.msg)) {
        attestedCount++;
        findings.push({ sym, level: "suggestion", msg: f.msg + " — attested (defensible, see proof)" });
        continue;
      }
      findings.push({ sym, level: f.level, msg: f.msg });
    }
  }

  const counts = findings.reduce((m, f) => ((m[f.level] = (m[f.level] || 0) + 1), m), {});
  const blockers = findings.filter((f) => f.level === "error");

  const L = ["# Prose gate (string-audit)\n"];
  L.push(
    `🔴 ${counts.error || 0} error · 🟡 ${counts.warn || 0} warn · ⚪ ${counts.suggestion || 0} suggestion` +
      (attestedCount ? ` · ${attestedCount} overclaim attested (demoted)` : "") +
      "\n",
  );
  for (const f of [...findings].sort((a, b) => ORDER[a.level] - ORDER[b.level])) {
    L.push(`- ${GLYPH[f.level]} \`${f.sym}\` — ${f.msg}`);
  }
  const md = L.join("\n");
  console.log(md);
  await summary(md);

  if (strict && blockers.length) {
    console.error(`\ncheck-prose: ${blockers.length} error-level finding(s) under --strict → failing.`);
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
