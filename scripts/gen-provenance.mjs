#!/usr/bin/env node
// Emit dist/provenance.json — the build-provenance record for the ENTIRE site.
// Run at deploy time, after the keyless signing steps, with the GitHub Actions
// OIDC env in scope.
//
//   node scripts/gen-provenance.mjs
//
// Keyless attestations (GitHub Actions OIDC → Fulcio → Rekor, no stored key):
//   1. site manifest      — cosign sign-blob over dist/site.sha256 (the whole
//      served site, resume.pdf included). Verify the live bytes in place.
//   2. in-toto statement  — cosign sign-blob over dist/attestation.intoto.json
//      (the hermetic SLSA predicate: reproducible subjects + materials).
//   3. OCI artifact       — the built site pushed to GHCR and cosign-signed by
//      digest. Pullable + versioned.
// Proves WHO built the site and that it is intact — not that the build was safe
// or authorized. The signatures + Rekor entries are ground truth; this file is a
// convenience view, and the `verify` recipes are how to confirm it independently.
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

const repo = process.env.GITHUB_REPOSITORY || "bdelanghe/site";
const sha = process.env.GITHUB_SHA || "";
const ref = process.env.GITHUB_REF || "";
const runId = process.env.GITHUB_RUN_ID || "";
const workflowRef = process.env.GITHUB_WORKFLOW_REF || "";
const ociRef = process.env.OCI_REF || "";
const ociDigest = process.env.OCI_DIGEST || "";

const idFlags =
  `  --certificate-identity-regexp '^https://github.com/${repo}/' \\\n` +
  `  --certificate-oidc-issuer https://token.actions.githubusercontent.com`;

async function rekorIndex(bundleName) {
  const p = join(dist, bundleName);
  if (!(await exists(p))) return null;
  try {
    const b = JSON.parse(await readFile(p, "utf8"));
    const e = b?.verificationMaterial?.tlogEntries?.[0];
    return e?.logIndex != null ? String(e.logIndex) : null;
  } catch { return null; }
}

const manifestBytes = await readFile(join(dist, "site.sha256"));
const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
const fileCount = manifestBytes.toString("utf8").trim().split("\n").filter(Boolean).length;
const manifestIdx = await rekorIndex("site.sha256.sigstore.json");
const attIdx = await rekorIndex("attestation.intoto.json.sigstore.json");

const provenance = {
  scope: "entire-site",
  fileCount,
  builder: {
    repository: repo,
    commit: sha,
    ref,
    runId,
    workflowRef,
    issuer: "https://token.actions.githubusercontent.com",
  },
  siteManifest: {
    file: "site.sha256",
    sha256: manifestSha256,
    bundle: "site.sha256.sigstore.json",
    transparencyLog: "rekor.sigstore.dev",
    rekorLogIndex: manifestIdx,
    rekorEntry: manifestIdx ? `https://search.sigstore.dev/?logIndex=${manifestIdx}` : null,
    verify:
      `cosign verify-blob \\\n  --bundle site.sha256.sigstore.json \\\n${idFlags} \\\n  site.sha256\n` +
      `# then check the live bytes against the signed manifest:\nsha256sum -c site.sha256`,
  },
  intotoStatement: (await exists(join(dist, "attestation.intoto.json")))
    ? {
        file: "attestation.intoto.json",
        bundle: "attestation.intoto.json.sigstore.json",
        predicateType: "https://slsa.dev/provenance/v1",
        rekorLogIndex: attIdx,
        rekorEntry: attIdx ? `https://search.sigstore.dev/?logIndex=${attIdx}` : null,
        verify: `cosign verify-blob \\\n  --bundle attestation.intoto.json.sigstore.json \\\n${idFlags} \\\n  attestation.intoto.json`,
      }
    : null,
  ociArtifact: ociRef
    ? {
        registry: "ghcr.io",
        ref: ociRef,
        digest: ociDigest || null,
        pull: `oras pull ${ociRef}`,
        verify: `cosign verify ${ociDigest ? ociRef.split(":")[0] + "@" + ociDigest : ociRef} \\\n${idFlags}`,
      }
    : null,
  caveat:
    "Provenance proves who built this site and that it is intact — not that the build was safe or authorized. Identity and integrity, not legitimacy.",
};

await writeFile(join(dist, "provenance.json"), JSON.stringify(provenance, null, 2) + "\n");
console.log(`✓ provenance: entire site (${fileCount} files) · manifest sha256:${manifestSha256.slice(0, 12)}… · rekor#${manifestIdx ?? "?"}${ociRef ? ` · oci ${ociRef}` : ""} → dist/provenance.json`);
