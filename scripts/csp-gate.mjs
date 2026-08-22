#!/usr/bin/env node
// Prove the emitted policy actually covers the built bytes — a gate, not a report.
//
// It re-derives every hash from dist/ and checks the policy in dist/_headers against them,
// rather than trusting what gen-csp.mjs recorded. A policy that validates itself proves
// nothing (docs/agentic-code-hygiene.md rule 3).
//
// Fails on: a missing policy; an inline block whose hash the policy lacks (the page would
// break in the browser); any 'unsafe-*' keyword; a surviving style attribute; a missing
// default-src 'none'.
//
//   npm run check:csp
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collect, UNSAFE } from "./csp-lib.mjs";

const dist = resolve(process.cwd(), process.env.DIST || "dist");
let errors = 0;
const err = (m) => { console.error(`  ✗ ${m}`); errors++; };

const headers = await readFile(join(dist, "_headers"), "utf8");
const m = /^\s*Content-Security-Policy:\s*(.+)$/im.exec(headers);
if (!m) {
  console.error("✗ csp-gate: no Content-Security-Policy in dist/_headers — run scripts/gen-csp.mjs");
  process.exit(1);
}
const csp = m[1].trim();
const all = [...headers.matchAll(/^\s*Content-Security-Policy:/gim)].length;
if (all > 1) err(`${all} Content-Security-Policy lines — Cloudflare merges rules and browsers enforce the INTERSECTION`);

const found = await collect(dist);
for (const a of found.attrs) err(`${a.file}: ${a.n} inline style attribute(s) — cannot be hashed`);

const directive = (name) => (new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`).exec(csp) || [])[1] || "";
const scriptSrc = directive("script-src");
const styleSrc = directive("style-src");

for (const h of found.scripts) if (!scriptSrc.includes(h)) err(`script-src is missing ${h} — that inline script would be blocked`);
for (const h of found.styles) if (!styleSrc.includes(h)) err(`style-src is missing ${h} — that inline style block would be blocked`);
for (const u of UNSAFE) if (csp.includes(u)) err(`policy contains ${u}`);
if (!/(?:^|;)\s*default-src\s+'none'/.test(csp)) err("no default-src 'none' — anything not named falls through to the default");

if (errors) {
  console.error(`✗ csp-gate: ${errors} problem(s) over ${found.scripts.length} script + ${found.styles.length} style hash(es)`);
  process.exit(1);
}
console.log(`✓ csp-gate: policy covers every inline block — ${found.scripts.length} script + ${found.styles.length} style hash(es), 0 style attributes, no unsafe-* keywords.`);
