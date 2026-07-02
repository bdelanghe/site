#!/usr/bin/env node
// Token Accessibility suite runner for the brand tokens.
//   1. VERIFY the vendored, hash-pinned conformance-kit Token Accessibility suite
//      against vendor/conformance-kit/provenance.json (fail-closed if a vendored
//      byte drifts — every member file is checked, not just the palette gate).
//   2. RUN the whole suite (palette · pairing · typography · targetSize · opacity ·
//      likeness) via the vendored unified runner over tokens/token-a11y.json, and
//      FAIL-CLOSED (exit 1) if any gated member fails.
// Zero local deps; the gates themselves are pure/offline.
//
//   node tools/token-a11y.mjs            # verify pin + run the whole suite
//   node tools/token-a11y.mjs --verify   # only verify the vendor pin
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const vendor = join(root, "vendor", "conformance-kit");

async function sha256(path) {
  return "sha256:" + createHash("sha256").update(await readFile(path)).digest("hex");
}

async function verifyPin() {
  const prov = JSON.parse(await readFile(join(vendor, "provenance.json"), "utf8"));
  let bad = 0;
  for (const [rel, want] of Object.entries(prov.files)) {
    const got = await sha256(join(vendor, rel));
    const ok = got === want;
    if (!ok) bad++;
    console.log(`   ${ok ? "✓" : "✗"} ${rel}${ok ? "" : `\n       want ${want}\n       got  ${got}`}`);
  }
  if (bad) {
    console.error(`✗ token-a11y: vendor pin verification FAILED (${bad} file(s) drifted from ${prov.commit}). Re-vendor or restore.`);
    process.exit(1);
  }
  console.log(`✓ token-a11y: vendor pin verified (conformance-kit @ ${prov.commit.slice(0, 12)}, PR #25)`);
}

function memberTail(name, m) {
  if (m.error) return `error — ${m.error}`;
  const s = m.summary || {};
  switch (name) {
    case "palette": return `${s.pairs} pair(s), ${s.failingPairs} failing, ${s.categoricalCollapses} collapse(s)`;
    case "pairing": return `${s.total} pair(s), ${s.failing} failing${m.gated === false ? " (report-only)" : ""}`;
    case "typography": return `${s.styles} style(s), ${s.errors} error(s), ${s.warnings} warn(s)`;
    case "targetSize": return `${s.targets} target(s), ${s.belowAA} below AA${m.coverage === "none" ? " (none declared)" : ""}`;
    case "opacity": return `${s.usages} usage(s), ${s.failing} failing`;
    case "likeness": return `${s.redundantTokens ?? s.nearDuplicates} redundant near-dup(s) + ${s.identicalPairs ?? 0} intentional alias(es), ${s.categoricalCollapses} collapse(s)`;
    default: return "";
  }
}

async function main() {
  console.log("\n  TOKEN ACCESSIBILITY SUITE — palette · pairing · typography · target-size · opacity · likeness");
  console.log("  " + "─".repeat(64));
  await verifyPin();
  if (process.argv.includes("--verify")) return;

  const configPath = join(root, "tokens", "token-a11y.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const { runTokenA11y } = await import(join(vendor, "gates", "token-a11y.mjs"));
  const report = await runTokenA11y(config, dirname(configPath));

  console.log("");
  for (const [name, m] of Object.entries(report.members)) {
    console.log(`   ${m.passed === false ? "✗" : "✓"} ${name.padEnd(11)} ${memberTail(name, m)}`);
  }

  if (!report.passed) {
    console.error(`\n✗ token-a11y: FAIL — ${report.summary.failing.join(", ")} member(s) failing. No exemptions.`);
    process.exit(1);
  }
  console.log("\n✓ token-a11y: clean — the brand tokens pass the whole Token Accessibility standard.");
}

main().catch((e) => {
  console.error("✗ token-a11y:", e.stack || e.message);
  process.exit(1);
});
