#!/usr/bin/env node
// Re-proving gate: known critical/high vulnerabilities in what this site SHIPS.
//
// Feeds the conformance criterion `security.no-critical-vulns` (the kit's
// `vulns` evidence). HONEST SCOPING: this site is a static artifact with ZERO
// runtime dependencies — every entry in package.json is a devDependency (the
// build toolchain), absent from the deployed bytes. So "exploitable vulns in the
// shipped site" is the PRODUCTION-scoped audit (`npm audit --omit=dev`), not the
// build toolchain's advisories (those are tracked separately by `npm run audit`).
//
// Re-proven on every build, BLOCKS on regression: the committed evidence value in
// data/conformance-evidence.json (`evidence.vulns.knownCriticalOrHighVulns`) must
// not be exceeded by a fresh `npm audit`. A newly-disclosed critical/high in a
// production dependency therefore turns CI red until it is fixed — the declaration
// cannot drift below reality.
//
//   node scripts/vuln-gate.mjs            # measure + print
//   node scripts/vuln-gate.mjs --check    # measure + block if reality > committed

import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

// `npm audit` exits non-zero when vulnerabilities are found, so capture rather
// than throw. --omit=dev scopes to production (shipped) deps; --json for parsing.
function auditProd() {
  let out;
  try {
    out = execFileSync("npm", ["audit", "--json", "--omit=dev"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (e) {
    out = e.stdout; // non-zero exit still carries the JSON report on stdout
  }
  const v = JSON.parse(out).metadata.vulnerabilities;
  return { critical: v.critical, high: v.high, measured: v.critical + v.high };
}

const { critical, high, measured } = auditProd();

const contract = JSON.parse(
  await readFile(join(root, "data", "conformance-evidence.json"), "utf8"),
);
const committed = contract.evidence?.vulns?.knownCriticalOrHighVulns ?? 0;

const summary =
  `vuln-gate: ${measured} known critical/high in production deps ` +
  `(${critical} critical, ${high} high) · committed ${committed}`;

if (CHECK && measured > committed) {
  console.error(`✗ ${summary}`);
  console.error(
    `  a production dependency has a newly-exploitable critical/high vuln. ` +
      `Fix it, or (if accepted) update evidence.vulns.knownCriticalOrHighVulns.`,
  );
  process.exit(1);
}

console.log(`✓ ${summary}`);
