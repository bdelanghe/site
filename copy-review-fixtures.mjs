#!/usr/bin/env node
// Regression harness for the copy-review gate.
//
// A small corpus of severity-anchored fixtures — most of them real catches a human
// made on this résumé — run through the *actual* reviewer (copy-review.mjs's
// reviewCopy) to assert it still classifies them the way it should. This is how
// "every human catch becomes a permanent test": if a prompt tweak starts blocking a
// defensible metric again (the flip-flop), or stops flagging unexplained jargon, this
// fails loudly instead of the regression shipping silently.
//
// It checks DIRECTIONAL invariants, not exact severities — an LLM judge isn't
// bit-for-bit deterministic even at temperature 0:
//   • expect "pass"  → the snippet must NOT draw a blocker (the flip-flop failure mode).
//   • expect "flag"  → the snippet must draw a finding at >= minSeverity (default nit).
//
// Usage:  node copy-review-fixtures.mjs           [npm run check:copy-fixtures]
// Auth:   ANTHROPIC_API_KEY — skips cleanly (exit 0) if unset.
// Cost:   one API call per fixture, so run it on demand, not on every PR.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewCopy } from "./copy-review.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const RANK = { nit: 1, suggestion: 2, blocker: 3 };
const NAME = ["none", "nit", "suggestion", "blocker"];

// Wrap a fixture snippet in a minimal, plausible résumé bundle so the reviewer judges
// it the way it would in context. The snippet is the only substantive line, so any
// finding is about it — we take the highest severity across all findings.
const bundleFor = (snippet) => ({
  experience: [{ org: "Example Co", role: "Software Engineer", bullets: [snippet] }],
});
const maxSeverity = (findings) =>
  (findings || []).reduce((hi, f) => Math.max(hi, RANK[f.severity] || 0), 0);

async function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}

function evaluate(fx, hi) {
  if (fx.expect === "pass") {
    return hi < RANK.blocker
      ? { status: "ok", detail: "no blocker (as expected)" }
      : { status: "FAIL", detail: "drew a blocker on a PASS fixture" };
  }
  const need = RANK[fx.minSeverity || "nit"];
  return hi >= need
    ? { status: "ok", detail: `flagged ${NAME[hi]} (>= ${fx.minSeverity || "nit"})` }
    : { status: "FAIL", detail: `expected >= ${fx.minSeverity || "nit"}, got ${NAME[hi]}` };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const msg = "copy-review-fixtures: skipped — ANTHROPIC_API_KEY is not set.";
    console.log(msg);
    await summary(`# Copy-review fixtures\n\n⚠️ _${msg}_`);
    return 0;
  }
  const fixtures = JSON.parse(
    await readFile(join(root, "data/audit/copy-review-fixtures.json"), "utf8"),
  );

  const rows = [];
  for (const fx of fixtures) {
    try {
      const out = await reviewCopy(bundleFor(fx.snippet), apiKey);
      if (out.skip) {
        rows.push({ fx, status: "skip", detail: out.skip });
        continue;
      }
      const hi = maxSeverity(out.result.findings);
      rows.push({ fx, ...evaluate(fx, hi) });
    } catch (err) {
      // Infra errors (rate limit, network) are skips, not regressions.
      rows.push({ fx, status: "skip", detail: `API error: ${err.message}` });
    }
  }

  const fails = rows.filter((r) => r.status === "FAIL");
  const skips = rows.filter((r) => r.status === "skip");
  const ok = rows.length - fails.length - skips.length;

  const lines = ["# Copy-review fixtures\n", `${ok}/${rows.length} ok · ${fails.length} failed · ${skips.length} skipped\n`];
  for (const r of rows) {
    const icon = r.status === "ok" ? "✅" : r.status === "FAIL" ? "❌" : "⚪";
    const want = r.fx.expect === "pass" ? "pass" : `flag ≥ ${r.fx.minSeverity || "nit"}`;
    lines.push(`- ${icon} \`${r.fx.id}\` (${want}) — ${r.detail}`);
  }
  const md = lines.join("\n");
  console.log(md);
  await summary(md);

  if (skips.length === rows.length) {
    console.log("\nAll fixtures skipped (API unavailable) — treated as a pass.");
    return 0;
  }
  if (fails.length) {
    console.error(`\ncopy-review-fixtures: ${fails.length} classification regression(s).`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
