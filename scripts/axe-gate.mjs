#!/usr/bin/env node
// Re-proving gate: axe-core serious/critical accessibility violations over the
// BUILT pages. Feeds the conformance criterion `a11y.axe-serious-critical`
// (the kit's `axe` evidence: { serious, critical }).
//
// HEADLESS, BUILD-ORIENTED, NO BROWSER: axe-core is injected into jsdom (a pure
// Node DOM), so this runs in plain CI with no Chromium/Playwright. The trade-off
// is honest and explicit: jsdom does not lay out or paint, so the rules that need
// real rendering — color-contrast above all — CANNOT run there and are DISABLED
// here. That coverage is not lost: lone's static `color_contrast` validator
// already checks contrast under `a11y.wcag22-aa-auto`. So this gate covers the
// structural / ARIA / name / role family; contrast is covered statically by lone.
//
// Re-proven on every build, BLOCKS on regression: the committed evidence in
// data/conformance-evidence.json (`evidence.axe`) must not be exceeded by a fresh
// scan of dist/.
//
//   node scripts/axe-gate.mjs            # measure + print
//   node scripts/axe-gate.mjs --check    # measure + block if reality > committed

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import axe from "axe-core";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, process.env.DIST || "dist");
const CHECK = process.argv.includes("--check");

// Rules jsdom cannot evaluate (no layout / no paint). color-contrast is the
// canonical one; lone covers contrast statically, so disabling it here is honest.
const JSDOM_INCOMPATIBLE = ["color-contrast"];

async function* htmlFiles(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* htmlFiles(p);
    else if (e.name.endsWith(".html")) yield p;
  }
}

let serious = 0, critical = 0;
const offenders = [];

for await (const file of htmlFiles(distDir)) {
  const html = await readFile(file, "utf8");
  const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    dom.window.eval(axe.source);
    const results = await dom.window.axe.run(dom.window.document, {
      resultTypes: ["violations"],
      rules: Object.fromEntries(JSDOM_INCOMPATIBLE.map((id) => [id, { enabled: false }])),
    });
    for (const v of results.violations) {
      if (v.impact === "critical") critical += v.nodes.length;
      else if (v.impact === "serious") serious += v.nodes.length;
      if (v.impact === "critical" || v.impact === "serious") {
        offenders.push(`${relative(distDir, file)}: ${v.id} (${v.impact}×${v.nodes.length})`);
      }
    }
  } finally {
    dom.window.close();
  }
}

const measured = serious + critical;
const contract = JSON.parse(
  await readFile(join(root, "data", "conformance-evidence.json"), "utf8"),
);
const committed = (contract.evidence?.axe?.serious ?? 0) + (contract.evidence?.axe?.critical ?? 0);

const summary =
  `axe-gate: ${measured} serious/critical (${critical} critical, ${serious} serious) ` +
  `over built pages [color-contrast deferred to lone] · committed ${committed}`;

if (CHECK && measured > committed) {
  console.error(`✗ ${summary}`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}

console.log(`✓ ${summary}`);
