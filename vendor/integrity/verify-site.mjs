#!/usr/bin/env node
// integrity · verify-site — independently verify a deployed site against its own
// signed, whole-site provenance. The honest counterpart to the in-page badge:
// run this from OUTSIDE the page (your shell, CI, an extension) so trust doesn't
// come from anything the page itself computes.
//
//   node integrity/verify-site.mjs https://bounded.tools
//   node integrity/verify-site.mjs ./dist            # a local build dir
//
// What it does:
//   1. loads /provenance.json (identity, Rekor index, OCI ref)
//   2. loads /site.sha256 + /site.sha256.sigstore.json (the signed manifest)
//   3. if `cosign` is on PATH: `cosign verify-blob` the manifest against the
//      builder's OIDC identity + Rekor (the real cryptographic check). Otherwise
//      prints the exact recipe and marks the signature step SKIPPED.
//   4. re-hashes every file the manifest lists (fetched live, or read locally) and
//      checks it byte-for-byte — integrity of the actual served bytes.
// Exit 0 iff every checked file matches AND (cosign verified OR was skipped with a
// printed recipe). Exit 1 on any mismatch or a failed cosign verify.
//
// Dependency-free: node:crypto + fetch + cosign (optional, shelled out). Designed
// to later publish to npm with Sigstore provenance and be consumed by a CLI, a
// browser extension, or CI policy.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, mkdtemp, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = process.argv[2];
if (!target) {
  console.error("usage: verify-site <https://site | ./dist>");
  process.exit(2);
}
const isUrl = /^https?:\/\//.test(target);
const base = isUrl ? target.replace(/\/$/, "") : target;
const sha256hex = (buf) => createHash("sha256").update(buf).digest("hex");

async function load(path) {
  if (isUrl) {
    const res = await fetch(`${base}/${path}`);
    if (!res.ok) throw new Error(`GET /${path} → ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  return readFile(join(base, path));
}

let failures = 0;
const log = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) failures++; };

// 1 + 2: provenance + signed manifest
const provenance = JSON.parse((await load("provenance.json")).toString("utf8"));
const repo = provenance?.builder?.repository || "";
const manifest = (await load("site.sha256")).toString("utf8");
const bundle = (await load("site.sha256.sigstore.json")).toString("utf8");
console.log(`· site: ${base}`);
console.log(`· builder: ${repo} @ ${(provenance?.builder?.commit || "").slice(0, 7)} · rekor#${provenance?.siteManifest?.rekorLogIndex ?? "?"}`);

// 3: signature (cosign if available)
const cosign = spawnSync("cosign", ["version"], { stdio: "ignore" });
if (cosign.status === 0) {
  const dir = await mkdtemp(join(tmpdir(), "verify-site-"));
  await writeFile(join(dir, "site.sha256"), manifest);
  await writeFile(join(dir, "site.sha256.sigstore.json"), bundle);
  const r = spawnSync("cosign", [
    "verify-blob",
    "--bundle", join(dir, "site.sha256.sigstore.json"),
    "--certificate-identity-regexp", `^https://github.com/${repo}/`,
    "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com",
    join(dir, "site.sha256"),
  ], { encoding: "utf8" });
  log(r.status === 0, `cosign verify-blob (identity ^github.com/${repo}/ + Rekor)`);
  if (r.status !== 0) console.error((r.stderr || "").trim());
} else {
  console.log("· cosign not found — signature check SKIPPED. Verify it out-of-band:");
  console.log(`    ${(provenance?.siteManifest?.verify || "").split("\n").join("\n    ")}`);
}

// 4: byte-for-byte integrity of every listed file
const entries = manifest.trim().split("\n").filter(Boolean).map((l) => {
  const [hash, ...rest] = l.split("  ");
  return { hash, path: rest.join("  ") };
});
let mismatches = 0;
for (const { hash, path } of entries) {
  try {
    const got = sha256hex(await load(path));
    if (got !== hash) { mismatches++; console.log(`  ✗ ${path}: ${got.slice(0, 12)}… ≠ ${hash.slice(0, 12)}…`); }
  } catch (e) { mismatches++; console.log(`  ✗ ${path}: ${e.message}`); }
}
log(mismatches === 0, `${entries.length} files match the signed manifest${mismatches ? ` (${mismatches} mismatch)` : ""}`);

console.log(failures ? `\n✗ verification FAILED (${failures})` : `\n✓ verified: served bytes match this build's signed provenance`);
process.exit(failures ? 1 : 0);
