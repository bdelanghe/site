#!/usr/bin/env node
// Vendor (or re-vendor) the standalone @bounded-systems/conformance-kit into
// vendor/conformance-kit/ — hash-pinned, same pattern as vendor/string-audit/. No
// submodule. The kit subsumes what used to live in vendor/integrity/ (provenance
// tooling) PLUS the conformance gates + generators, so there is now ONE vendored
// copy of all the shared build/gate/generator tooling.
//
//   node scripts/vendor-integrity.mjs                 # re-fetch @ pinned commit, re-pin
//   node scripts/vendor-integrity.mjs --ref <sha>     # fetch a new commit, re-pin
//   node scripts/vendor-integrity.mjs --pin           # re-hash the local copy, re-pin (no network)
//   node scripts/vendor-integrity.mjs --check         # verify vendored files match the pin (CI gate)
//
// --check is pure (no network) and runs in prebuild, so a hand-edited or drifted
// vendored copy fails the build closed.
//
// NOTE: the pinned set is the kit's TOOL files only. Per-consumer install/baseline
// artifacts the kit does NOT ship — integrity/{verify,structure-audit}/package-lock.json
// and integrity/structure-audit/structure.json — live alongside the vendored kit but
// are site-managed (the SBOM reads the lockfiles; structure.json is this site's
// committed structure baseline), so they are intentionally NOT hash-pinned here.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor", "conformance-kit");
const provPath = join(vendor, "provenance.json");
const SOURCE = "https://github.com/bounded-systems/conformance-kit";
// The kit's tool files (the canonical, site-agnostic implementations). Consumer
// artifacts (package-lock.json, structure.json) are deliberately excluded — see header.
const FILES = [
  "integrity/verify-site.mjs",
  "integrity/gen-sitemanifest.mjs",
  "integrity/gen-provenance.mjs",
  "integrity/http-probe.mjs",
  "integrity/structure-audit/audit.mjs",
  "integrity/structure-audit/package.json",
  "integrity/verify/verify.mjs",
  "integrity/verify/README.md",
  "gates/sbom/gen-sbom.mjs",
  "gates/sbom/check-sbom.mjs",
  "gates/conformance-report.mjs",
  "gates/conformance/web-build.mjs",
  "gates/conformance/conformance.mjs",
  "gates/axe-gate.mjs",
  "gates/vuln-gate.mjs",
  "gates/html-validator-gate.mjs",
  "gates/baseline-gate.mjs",
  "gates/shacl-runner.mjs",
  "gates/seo-gate.mjs",
  "gates/readability-gate.mjs",
  "gates/commonmark-runner.mjs",
  "gates/semantic/gate.ts",
  "gates/semantic/deno.json",
  "generators/gen-cid.mjs",
  "generators/gen-identity.mjs",
  "generators/openapi.mjs",
  "emitters/index.mjs",
  "lib/config.mjs",
  "lib/schema-validate.mjs",
  "package.json",
  "LICENSE",
  "README.md",
];
const sha256 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const PIN = args.includes("--pin");
const refArg = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : null;

if (CHECK) {
  const prov = JSON.parse(await readFile(provPath, "utf8"));
  const drift = [];
  for (const f of FILES) {
    let got;
    try { got = sha256(await readFile(join(vendor, f))); } catch { got = "(missing)"; }
    if (got !== prov.files[f]) drift.push(f);
  }
  if (drift.length) {
    console.error(`✗ vendor/conformance-kit drift — ${drift.join(", ")}. Re-vendor: npm run vendor:kit -- --ref ${prov.commit}`);
    process.exit(1);
  }
  console.log(`✓ vendor/conformance-kit pinned ok — ${FILES.length} files @ ${String(prov.commit).slice(0, 9)}`);
  process.exit(0);
}

const prevProv = JSON.parse(await readFile(provPath, "utf8").catch(() => "{}"));

async function writePin(ref, files) {
  const out = {
    source: SOURCE,
    ref,
    commit: ref,
    fetched: new Date().toISOString().slice(0, 10),
    note: "Vendored, hash-pinned copy of bounded-systems/conformance-kit (the one shared build/gate/generator toolkit — subsumes the former vendor/integrity/). Re-vendor: npm run vendor:kit. Verified against these hashes before use (npm run check:integrity runs --check). Site-managed consumer artifacts (integrity/{verify,structure-audit}/package-lock.json, integrity/structure-audit/structure.json) are NOT pinned here.",
    files: Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]])),
  };
  await writeFile(provPath, JSON.stringify(out, null, 2) + "\n");
}

if (PIN) {
  // Re-hash whatever is already vendored on disk (no network). Used when the kit was
  // copied in at a known commit and we just need to (re)write the pin manifest.
  const ref = refArg || prevProv.commit;
  if (!ref) { console.error("✗ --pin needs a known commit; pass --ref <sha> or seed provenance.json.commit"); process.exit(2); }
  const files = {};
  for (const f of FILES) files[f] = sha256(await readFile(join(vendor, f)));
  await writePin(ref, files);
  console.log(`✓ pinned vendor/conformance-kit @ ${String(ref).slice(0, 9)} — ${FILES.length} files (local re-hash)`);
  process.exit(0);
}

// Re-vendor: fetch the canonical files from bounded-systems/conformance-kit at <ref>.
const ref = refArg || prevProv.commit || "main";
const base = `https://raw.githubusercontent.com/bounded-systems/conformance-kit/${ref}`;
const files = {};
for (const f of FILES) {
  const res = await fetch(`${base}/${f}`);
  if (!res.ok) { console.error(`✗ fetch ${f} → ${res.status}`); process.exit(2); }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(join(vendor, f)), { recursive: true });
  await writeFile(join(vendor, f), buf);
  files[f] = sha256(buf);
}
await writePin(ref, files);
console.log(`✓ vendored conformance-kit @ ${ref} — ${FILES.length} files`);
