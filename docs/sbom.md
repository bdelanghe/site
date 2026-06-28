# SBOM — a signed SPDX bill of materials for the whole supply chain

**Status:** Implemented (2026-06-27) · **Owner:** Robert DeLanghe · **Scope:** robertdelanghe.dev

> **Live.** `scripts/gen-sbom.mjs` emits `dist/sbom.spdx.json` (SPDX 2.3) on every build,
> `scripts/check-sbom.mjs` (`npm run check:sbom`) is the fail-closed completeness gate, the
> SBOM is an **in-toto subject** of the build attestation, and the deploy workflow
> keyless-signs it with the same Fulcio/Rekor identity as the attestation + whole-site
> manifest. Zero new dependencies — Node built-ins only, matching the repo's hermetic style.

## Why

The in-toto/SLSA statement (`scripts/gen-attestation.mjs`) records the build **inputs** —
`data/*.json`, the brand tokens/content/CSS, the brand git rev, the source commit — as
content-addressed materials. What it never enumerated is the **dependency closure**: the npm
packages and the Nix toolchain the build actually pulls from. The SBOM closes that gap.

## What it covers

A deterministic SPDX 2.3 document, a pure function of the committed lockfiles (no network, no
wall clock):

| Source | Read from | Each package carries |
|---|---|---|
| **npm** | `package-lock.json` + `vendor/conformance-kit/integrity/verify/package-lock.json` + `vendor/conformance-kit/integrity/structure-audit/package-lock.json` | `versionInfo`, `downloadLocation` (resolved registry tarball), a `pkg:npm` purl, and a checksum — the lockfile integrity SRI decoded from base64 to SPDX-legal hex |
| **Nix inputs** | `flake.lock` (nixpkgs + the `bounded-systems/brand` submodule) | the locked `rev` as `versionInfo`, a `git+https` `downloadLocation`, a `pkg:github` purl, and a SHA256 checksum decoded from the `narHash` SRI |

Determinism: packages are sorted (Nix before npm, then name, then version), the
`documentNamespace` is a SHA256 of the package set, and `creationInfo.created` is derived from
the newest `flake.lock` `lastModified` — so identical lockfiles produce byte-identical output.
It runs **before** `gen-sitemanifest.mjs`, so `dist/sbom.spdx.json` is covered by the
whole-site `site.sha256` manifest.

## Completeness gate (`npm run check:sbom`)

Fail-closed, same `process.exit(1)` contract as the css-token-purity gate. Three checks, all
order-free:

1. **SPDX 2.3 well-formedness** — the document and every package carry their required fields
   (`spdxVersion` is `SPDX-2.3`, `SPDXID`, `dataLicense`, namespace, `creationInfo`; per
   package: `name`, `SPDXID`, `downloadLocation`; no malformed or duplicate `SPDXID`s).
2. **Pinned set ⊆ SBOM** — every `flake.lock` input (nixpkgs + brand) appears as an SPDX
   package at the same rev, and any package-reference the attestation enumerates as a
   `resolvedDependency` (the brand, `pkg:jsr/@bounded-systems/brand`) appears at the same rev.
   File-path materials (`data/*.json`, `brand/*.css`) are content inputs, not redistributable
   packages, so they are intentionally out of SBOM scope.
3. **SBOM ⊆ pinned set** — every Nix-sourced SPDX package (`pkg:github`) traces back to a real
   `flake.lock` rev, so no orphan Nix entry can slip in.

The gate runs inside `npm run build` (after `gen-attestation`) and again in CI.

## Signing

The deploy workflow (`.github/workflows/deploy.yml`) keyless-signs the SBOM blob with
`cosign sign-blob` → a short-lived Fulcio cert minted from the GitHub Actions OIDC identity,
logged in Rekor — the same identity that signs the attestation and the whole-site manifest. No
held key. The signature lands in `dist/sbom.spdx.json.sigstore.json` (signed **after** the
manifest, so the sidecar stays out of `site.sha256`, like the attestation + manifest
sidecars), and both the SBOM and its signature ride inside the signed OCI artifact published
to GHCR and promoted to production.
