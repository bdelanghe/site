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
import { checkCss } from "./check-css.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = join(root, "node_modules", "@bdelanghe", "brand");
const dist = join(root, "dist");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };

const COMMIT = process.env.CF_PAGES_COMMIT_SHA || process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "";

// Stamp the /provenance seal + source-material with the real commit + date — the
// hermetic build can't know them, so build.mjs emits @@COMMIT@@/@@COMMIT_SHORT@@/
// @@DATE@@ placeholders. MUST run BEFORE the subject digests below so the signed
// subject digest matches the served (stamped) page.
const provHtml = join(dist, "provenance.html");
if (await exists(provHtml)) {
  const short = COMMIT ? COMMIT.slice(0, 7) : "(local)";
  const commitLink = COMMIT ? `<a href="https://github.com/bdelanghe/site/commit/${COMMIT}" data-build-commit="${COMMIT}">${short}</a>` : "(local)";
  const stampDate = new Date().toISOString().slice(0, 10);
  let html = await readFile(provHtml, "utf8");
  html = html.replaceAll("@@COMMIT@@", commitLink).replaceAll("@@COMMIT_SHORT@@", short).replaceAll("@@DATE@@", stampDate);
  await writeFile(provHtml, html);
}

// Same stamp for the Markdown twin /provenance.md — but a Markdown commit link.
const provMd = join(dist, "provenance.md");
if (await exists(provMd)) {
  const short = COMMIT ? COMMIT.slice(0, 7) : "(local)";
  const commitMd = COMMIT ? `[${short}](https://github.com/bdelanghe/site/commit/${COMMIT})` : "(local)";
  const stampDate = new Date().toISOString().slice(0, 10);
  let md = await readFile(provMd, "utf8");
  md = md.replaceAll("@@COMMIT@@", commitMd).replaceAll("@@COMMIT_SHORT@@", short).replaceAll("@@DATE@@", stampDate);
  await writeFile(provMd, md);
}

// subject — the built artifacts, by digest (what the attestation is ABOUT). The
// SPDX SBOM (dist/sbom.spdx.json, written by gen-sbom.mjs just before this) is a
// subject too, so the statement vouches for the exact bill-of-materials bytes;
// check-sbom.mjs then reconciles that SBOM against the resolvedDependencies below.
const subjectFiles = ["index.html", "provenance.html", "resume.html", "blog.html", "sbom.spdx.json"];
const subject = [];
for (const f of subjectFiles) if (await exists(join(dist, f))) subject.push({ name: f, digest: { sha256: sha256(await readFile(join(dist, f))) } });

// materials — the build inputs, content-addressed where computable
const materials = [];
for (const f of ["data/profile.json", "data/presentation.json", "data/site.json"]) if (await exists(join(root, f))) materials.push({ uri: f, digest: { sha256: sha256(await readFile(join(root, f))) } });
const brandPkg = (await exists(join(brand, "package.json"))) ? JSON.parse(await readFile(join(brand, "package.json"), "utf8")) : {};
// BRAND IS AN npm ARTIFACT NOW, AND THIS NAMES IT AS ONE.
//
// This used to emit `pkg:github/bdelanghe/brand` with a gitCommit read out of
// flake.lock, because brand was a git dependency pinned twice — once there and
// once in package-lock.json (#274). Both builds now consume the same registry
// tarball (#276), so flake.lock carries a narHash and no `rev` at all, and a
// git-shaped package-ref is simply the wrong description of the input.
//
// The tarball URL plus its lockfile integrity is a STRONGER claim than the
// commit was: it names the exact bytes both builds fetched, rather than a commit
// that a tarball was once built from. Same shape as the `git+https://…/site`
// material below — a source named by URI and digest.
//
// It is deliberately not a `pkg:` purl. The vendored kit reconciles pkg-refs to
// SPDX packages by gitCommit, which no npm-sourced ref can satisfy; filed
// upstream as bounded-systems/conformance-kit#68. Until the kit can express an
// npm-sourced pkg-ref, claiming one here would fail a check that is right to
// fail. The package is in the SBOM regardless — gen-sbom reads package-lock.
const lockJson = JSON.parse(await readFile(join(root, "package-lock.json"), "utf8"));
const brandLock = Object.entries(lockJson.packages ?? {})
  .find(([k]) => k.endsWith("node_modules/@bdelanghe/brand"))?.[1] ?? {};
if (brandLock.resolved) {
  materials.push({
    uri: brandLock.resolved,
    version: brandPkg.version,
    ...(brandLock.integrity ? { digest: { sri: brandLock.integrity } } : {}),
  });
} else if (brandPkg.version) {
  // No resolved URL means brand came from somewhere this script cannot name.
  // Attesting it vaguely is worse than refusing: the statement is the record.
  console.error("✗ attestation: @bdelanghe/brand has no resolved URL in package-lock.json — refusing to attest an unnameable input");
  process.exit(1);
}
// the design system itself — tokens (visual) + content strings (verbal), by digest
for (const f of ["tokens/tokens.json", "tokens/tokens.css", "content/strings.json", "css/base.css", "css/fonts.css"])
  if (await exists(join(brand, f))) materials.push({ uri: `brand/${f}`, digest: { sha256: sha256(await readFile(join(brand, f))) } });
if (COMMIT) materials.push({ uri: "git+https://github.com/bdelanghe/site", digest: { sha1: COMMIT } });

// Gate predicates — attest that the deterministic gates ran and passed, over the
// exact inputs (by digest). build.mjs already fails the build on a violation, so
// reaching here implies pass; re-running makes the claim self-contained (a verifier
// reads the attestation, not the CI logs). Defensive: refuse to attest a fail.
const purity = await checkCss({ root, brand });
if (!purity.ok) { console.error(`✗ css-token-purity failed at attestation (${purity.violations.length}) — refusing to sign`); process.exit(1); }
const gates = {
  "css-token-purity": {
    passed: true,
    spec: "https://robertdelanghe.dev/docs/css-token-purity",
    subject: { uri: "styles.css", digest: { sha256: sha256(await readFile(join(root, "styles.css"))) } },
    vocabulary: { uri: "brand/tokens/tokens.css", digest: { sha256: sha256(await readFile(join(brand, "tokens", "tokens.css"))) }, tokens: purity.vocabSize },
  },
};

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
    gates,
  },
};

// Write the unsigned in-toto Statement/v1. cosign keyless-signs this file in CI
// (see .github/workflows/deploy.yml); the signature + Rekor proof live in the
// sidecar bundle, bound to the GitHub Actions OIDC identity — no held key.
await writeFile(join(dist, "attestation.intoto.json"), JSON.stringify(statement, null, 2) + "\n");
console.log(`✓ attestation statement: ${subject.length} subjects · ${materials.length} materials → dist/attestation.intoto.json (keyless-signed in CI)`);
