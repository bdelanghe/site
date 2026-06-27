#!/usr/bin/env node
// Vendor (or re-vendor) the shared provenance tooling from bounded-systems/site's
// `integrity/` directory — the subtree-split target — hash-pinned, same pattern as
// vendor/string-audit/. No submodule.
//
//   node scripts/vendor-integrity.mjs                 # re-fetch @ pinned commit, re-pin
//   node scripts/vendor-integrity.mjs --ref <sha>     # fetch a new commit, re-pin
//   node scripts/vendor-integrity.mjs --check         # verify vendored files match the pin (CI gate)
//
// --check is pure (no network) and runs in prebuild, so a hand-edited or drifted
// vendored copy fails the build closed.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor", "integrity");
const provPath = join(vendor, "provenance.json");
const FILES = ["scripts/gen-sitemanifest.mjs", "scripts/gen-provenance.mjs", "verify-site.mjs"];
const sha256 = (buf) => "sha256:" + createHash("sha256").update(buf).digest("hex");

const args = process.argv.slice(2);
const CHECK = args.includes("--check");
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
    console.error(`✗ vendor/integrity drift — ${drift.join(", ")}. Re-vendor: npm run vendor:integrity -- --ref ${prov.commit}`);
    process.exit(1);
  }
  console.log(`✓ vendor/integrity pinned ok — ${FILES.length} files @ ${String(prov.commit).slice(0, 9)}`);
  process.exit(0);
}

// Re-vendor: fetch the canonical files from bounded-systems/site at <ref>.
const prevProv = JSON.parse(await readFile(provPath, "utf8").catch(() => "{}"));
const ref = refArg || prevProv.commit || "main";
const base = `https://raw.githubusercontent.com/bounded-systems/site/${ref}/integrity`;
const out = {
  source: "https://github.com/bounded-systems/site",
  path: "integrity/",
  ref,
  commit: ref,
  fetched: new Date().toISOString().slice(0, 10),
  note: "Vendored, hash-pinned copy of bounded-systems/site/integrity/. Re-vendor: npm run vendor:integrity. Verified against these hashes before use (npm run check runs --check).",
  files: {},
};
await mkdir(join(vendor, "scripts"), { recursive: true });
for (const f of FILES) {
  const res = await fetch(`${base}/${f}`);
  if (!res.ok) { console.error(`✗ fetch ${f} → ${res.status}`); process.exit(2); }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(join(vendor, f), buf);
  out.files[f] = sha256(buf);
}
const sorted = { ...out, files: Object.fromEntries(Object.keys(out.files).sort().map((k) => [k, out.files[k]])) };
await writeFile(provPath, JSON.stringify(sorted, null, 2) + "\n");
console.log(`✓ vendored integrity @ ${ref} — ${FILES.length} files`);
