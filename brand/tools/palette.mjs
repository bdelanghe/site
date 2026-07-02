#!/usr/bin/env node
// Palette gate runner for the brand tokens.
//   1. VERIFY the vendored, hash-pinned conformance-kit palette gate against
//      vendor/conformance-kit/provenance.json (fail-closed if a vendored byte drifts).
//   2. RUN the gate over the generated tokens.css + tokens/palette.pairings.json.
//      Fail-closed (exit 1) on ANY WCAG-AA / CVD / APCA / non-text / collapse failure.
// Zero local deps; the gate itself is pure/offline.
//
//   node tools/palette.mjs            # verify pin + run gate
//   node tools/palette.mjs --verify   # only verify the vendor pin
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
    console.log(`   ${ok ? "✓" : "✗"} ${rel} ${ok ? "" : `\n       want ${want}\n       got  ${got}`}`);
  }
  if (bad) {
    console.error(`✗ palette: vendor pin verification FAILED (${bad} file(s) drifted from ${prov.commit}). Re-vendor or restore.`);
    process.exit(1);
  }
  console.log(`✓ palette: vendor pin verified (conformance-kit @ ${prov.commit.slice(0, 12)})`);
}

async function main() {
  console.log("\n  PALETTE GATE — CVD-safe contrast · APCA · non-text (WCAG 1.4.11)");
  console.log("  " + "─".repeat(64));
  await verifyPin();
  if (process.argv.includes("--verify")) return;

  const { runPaletteGate } = await import(join(vendor, "gates", "palette-gate.mjs"));
  const report = await runPaletteGate({
    tokens: join(root, "tokens", "tokens.css"),
    pairings: join(root, "tokens", "palette.pairings.json"),
  });

  const s = report.summary;
  console.log(
    `\n  ${s.pairs} pairing(s) — ${s.failingPairs} failing ` +
      `(WCAG ${s.wcagFailures}, CVD ${s.cvdFailures}, APCA ${s.apcaFailures}, non-text ${s.nonTextFailures}) · ` +
      `${s.categoricalCollapses} categorical collapse(s)`,
  );
  for (const p of report.pairs) {
    const bits = [`W ${p.wcag.ratio.toFixed(2)}:1`];
    const cvd = ["deuteranopia", "protanopia", "tritanopia"].map((c) => p.cvd[c].ratio.toFixed(2)).join("/");
    bits.push(`CVD ${cvd}`);
    if (p.apca) bits.push(`APCA Lc ${p.apca.absLc} (min ${p.apca.min})`);
    console.log(`   ${p.passed ? "✓" : "✗"} ${p.name.padEnd(42)} [${p.kind}] ${bits.join("  ")}`);
  }
  if (!report.passed) {
    console.error("\n✗ palette gate: FAIL — fix the token(s) above. No exemptions.");
    process.exit(1);
  }
  console.log("\n✓ palette gate: clean — every pairing meets WCAG-AA, CVD-safe, APCA, and non-text contrast.");
}

main().catch((e) => {
  console.error("✗ palette:", e.stack || e.message);
  process.exit(1);
});
