#!/usr/bin/env node
// Emit a real in-toto / SLSA provenance STATEMENT for the build — the rich
// predicate (hermetic subjects + content-addressed materials), zero-dep
// (node:crypto for digests only). Runs AFTER build.mjs (operates on dist/),
// BEFORE the non-deterministic resume.pdf, so its subjects stay reproducible.
// Writes:
//   dist/attestation.intoto.json — the unsigned in-toto Statement/v1
//
// It is NOT signed here. Signing is keyless, in CI: cosign sign-blob mints a
// short-lived Fulcio cert from the GitHub Actions OIDC identity and logs the
// signature in Rekor (dist/attestation.intoto.json.sigstore.json). That retires
// the old self-managed ed25519 key — there is no key to hold, the signature is
// bound to a verifiable identity, and forgeries are publicly monitorable.
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

// subject — the built artifacts, by digest (what the attestation is ABOUT)
const subjectFiles = ["index.html", "provenance.html", "resume.html", "blog.html"];
const subject = [];
for (const f of subjectFiles) if (await exists(join(dist, f))) subject.push({ name: f, digest: { sha256: sha256(await readFile(join(dist, f))) } });

// materials — the build inputs, content-addressed where computable
const materials = [];
for (const f of ["data/profile.json", "data/presentation.json", "data/site.json"]) if (await exists(join(root, f))) materials.push({ uri: f, digest: { sha256: sha256(await readFile(join(root, f))) } });
const brandPkg = (await exists(join(root, "brand", "package.json"))) ? JSON.parse(await readFile(join(root, "brand", "package.json"), "utf8")) : {};
if (brandPkg.version) materials.push({ uri: "pkg:jsr/@bounded-systems/brand", version: brandPkg.version });
// the design system itself — tokens (visual) + content strings (verbal), by digest
for (const f of ["brand/tokens/tokens.json", "brand/tokens/tokens.css", "brand/content/strings.json", "brand/css/base.css", "brand/css/fonts.css"])
  if (await exists(join(root, f))) materials.push({ uri: f, digest: { sha256: sha256(await readFile(join(root, f))) } });
const COMMIT = process.env.CF_PAGES_COMMIT_SHA || process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "";
if (COMMIT) materials.push({ uri: "git+https://github.com/bdelanghe/site", digest: { sha1: COMMIT } });

// in-toto Statement/v1 carrying a SLSA provenance predicate
const statement = {
  _type: "https://in-toto.io/Statement/v1",
  subject,
  predicateType: "https://slsa.dev/provenance/v1",
  predicate: {
    buildDefinition: {
      buildType: "https://robertdelanghe.dev/build/v1",
      externalParameters: { source: "git+https://github.com/bdelanghe/site", commit: COMMIT || "(local)" },
      resolvedDependencies: materials,
    },
    runDetails: {
      builder: { id: "https://github.com/bdelanghe/site/.github/workflows" },
      metadata: { invocationId: COMMIT || "local", finishedOn: new Date().toISOString() },
    },
  },
};

// Write the unsigned in-toto Statement/v1. cosign keyless-signs this file in CI
// (see .github/workflows/deploy.yml); the signature + Rekor proof live in the
// sidecar bundle, bound to the GitHub Actions OIDC identity — no held key.
await writeFile(join(dist, "attestation.intoto.json"), JSON.stringify(statement, null, 2) + "\n");
console.log(`✓ attestation statement: ${subject.length} subjects · ${materials.length} materials → dist/attestation.intoto.json (keyless-signed in CI)`);
