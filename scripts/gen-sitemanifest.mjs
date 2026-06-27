#!/usr/bin/env node
// Content-address the ENTIRE built site. Walk dist/ and emit dist/site.sha256 —
// one `sha256␠␠relpath` line per served file, sorted, in the format
// `sha256sum -c` accepts. This single file is the whole-site digest the deploy
// keyless-signs (cosign sign-blob), so provenance covers every asset — including
// the deploy-time resume.pdf — not just the hermetic subjects in the in-toto
// statement. A visitor verifies the signature on this manifest, then checks any
// or all live files against it.
//
//   node scripts/gen-sitemanifest.mjs
//
// The provenance sidecars are excluded — they describe the site, they are not
// the site. Keep this exclude set in sync with the tar --exclude list in deploy.yml.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist");

const EXCLUDE = new Set([
  "site.sha256",
  "site.sha256.sigstore.json",
  "provenance.json",
  "attestation.intoto.json",
  "attestation.intoto.json.sigstore.json",
  "rekor/index.html",
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
console.log(`✓ site manifest: ${files.length} files → dist/site.sha256 (site digest sha256:${siteDigest.slice(0, 12)}…)`);
