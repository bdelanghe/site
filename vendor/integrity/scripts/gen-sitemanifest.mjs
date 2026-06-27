#!/usr/bin/env node
// integrity · gen-sitemanifest — content-address the ENTIRE built site.
//
// Walk $DIST (default ./dist relative to the working directory) and emit
// `$DIST/site.sha256`: one `sha256␠␠relpath` line per served file, sorted, in the
// exact format `sha256sum -c` accepts. This single file is the whole-site digest
// the deploy keyless-signs (cosign sign-blob), so provenance covers every asset.
// A visitor verifies the signature on this manifest, then checks the live bytes.
//
//   node integrity/scripts/gen-sitemanifest.mjs      # uses ./dist
//   DIST=out node integrity/scripts/gen-sitemanifest.mjs
//
// Canonical home for both sites. Resolved from cwd (not the file's location) so
// it runs identically whether invoked in-repo or vendored. The provenance
// sidecars are excluded — they describe the site, they are not the site, and the
// manifest can't hash its own signature. Keep EXCLUDE in sync with the tar
// --exclude list (or whole-dist tar) in the deploy pipeline.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

const dist = process.env.DIST ? join(process.cwd(), process.env.DIST) : join(process.cwd(), "dist");

// Superset of both sites' sidecars (a name that doesn't exist in a given site is
// simply never matched, so this is safe to share).
const EXCLUDE = new Set([
  "site.sha256",
  "site.sha256.sigstore.json",
  "provenance.json",
  "rekor/index.html",
  "attestation.intoto.json",
  "attestation.intoto.json.sigstore.json",
]);

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    const rel = relative(dist, abs);
    if (ent.isDirectory()) { out.push(...await walk(abs)); continue; }
    if (EXCLUDE.has(rel)) continue;
    out.push(rel);
  }
  return out;
}

const files = (await walk(dist)).sort();
const lines = [];
for (const rel of files) {
  const sha256 = createHash("sha256").update(await readFile(join(dist, rel))).digest("hex");
  lines.push(`${sha256}  ${rel}`);
}
const manifest = lines.join("\n") + "\n";
await writeFile(join(dist, "site.sha256"), manifest);

const siteDigest = createHash("sha256").update(manifest).digest("hex");
console.log(`✓ site manifest: ${files.length} files → ${process.env.DIST || "dist"}/site.sha256 (site digest sha256:${siteDigest.slice(0, 12)}…)`);
