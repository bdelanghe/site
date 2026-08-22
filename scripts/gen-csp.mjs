#!/usr/bin/env node
// Write the Content-Security-Policy into dist/_headers, with a hash for every inline
// block the build actually emitted.
//
// Runs LAST in `npm run build` — after gen-attestation.mjs, which stamps provenance.html.
// That ordering is the point: hashes are derived from the final served bytes, so a
// generator that edits HTML after this one would be caught by csp-gate.mjs rather than
// silently shipping a policy that blocks the page.
//
// The policy goes in the sitewide `/*` block, not per route. Cloudflare MERGES overlapping
// _headers rules, and two Content-Security-Policy headers on one response are enforced as
// their INTERSECTION — a per-route policy would combine with the sitewide one and block
// whatever the two do not both allow. One block, one policy, union of the hashes.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { collect, policy } from "./csp-lib.mjs";

const dist = resolve(process.cwd(), process.env.DIST || "dist");
const found = await collect(dist);

if (found.attrs.length) {
  const where = found.attrs.map((a) => `${a.file} (${a.n})`).join(", ");
  console.error(`✗ gen-csp: ${found.attrs.reduce((n, a) => n + a.n, 0)} inline style attribute(s) — ${where}`);
  console.error("  A style attribute cannot be hashed; covering one needs 'unsafe-hashes', which re-opens");
  console.error("  the hole the policy closes. Emit a class instead (see widthUtilities in build.mjs).");
  process.exit(1);
}

const csp = policy(found);
const headersPath = join(dist, "_headers");
const headers = await readFile(headersPath, "utf8");

// Insert into the first block, which build.mjs writes as the sitewide `/*` security block.
const lines = headers.split("\n");
if (lines[0].trim() !== "/*") {
  console.error(`✗ gen-csp: expected dist/_headers to open with the sitewide "/*" block, found ${JSON.stringify(lines[0])}`);
  process.exit(1);
}
if (/^\s*Content-Security-Policy:/im.test(headers)) {
  console.error("✗ gen-csp: dist/_headers already carries a Content-Security-Policy — refusing to add a second (they intersect).");
  process.exit(1);
}
lines.splice(1, 0, `  Content-Security-Policy: ${csp}`);
await writeFile(headersPath, lines.join("\n"));

console.log(`✓ CSP: ${found.scripts.length} script + ${found.styles.length} style hash(es), 0 style attributes → dist/_headers`);
