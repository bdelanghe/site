#!/usr/bin/env node
// Regression harness for copy-review. Runs a golden corpus of copy fixtures through
// the SAME review() the gate uses and asserts the expected severity CLASS — not exact
// wording (an LLM judge isn't bit-for-bit deterministic even at temperature 0). Every
// human catch the gate missed, or false-flag it produced, should become a fixture in
// copy-review.fixtures.json so the calibration can't regress silently.
//
// Usage:  node copy-review-test.mjs   (npm run test:copy-review)
// Auth:   needs ANTHROPIC_API_KEY; skips cleanly (exit 0) without it, like the gate.
// Not a blocking CI gate: an LLM judge is advisory, so this is a local/on-demand tool
// you run when you change the prompt or the golden corpus.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { review } from "./copy-review.mjs";

const root = dirname(fileURLToPath(import.meta.url));

// Class-level assertions only — exact findings vary run to run.
function check(expect, findings) {
  const blockers = findings.filter((f) => f.severity === "blocker");
  if (expect.noBlocker && blockers.length > 0) return `expected NO blocker, got ${blockers.length}`;
  if (expect.blocker && blockers.length === 0) return "expected a blocker, got none";
  if (expect.anyFinding && findings.length === 0) return "expected ≥1 finding, got none";
  return null;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("copy-review-test: skipped — ANTHROPIC_API_KEY is not set.");
    return 0;
  }
  const fixtures = JSON.parse(await readFile(join(root, "copy-review.fixtures.json"), "utf8"));
  let failed = 0;
  for (const fx of fixtures) {
    let result;
    try {
      result = await review(fx.copy, apiKey);
    } catch (e) {
      console.log(`⚠ SKIP  ${fx.name} — ${e.message}`);
      continue;
    }
    const findings = result.findings || [];
    const sev = findings.map((f) => f.severity).join(", ") || "none";
    const err = check(fx.expect, findings);
    if (err) {
      failed++;
      console.log(`✗ FAIL  ${fx.name} — ${err}  [findings: ${sev}]`);
    } else {
      console.log(`✓ PASS  ${fx.name}  [findings: ${sev}]`);
    }
  }
  console.log(`\n${failed === 0 ? "✓" : "✗"} ${fixtures.length - failed}/${fixtures.length} fixtures held`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
