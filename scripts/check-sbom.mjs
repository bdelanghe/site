#!/usr/bin/env node
// Site config shim → the vendored, hash-pinned conformance-kit SBOM completeness
// gate (vendor/conformance-kit/gates/sbom/check-sbom.mjs). Fail-closed: SBOM ↔
// flake.lock pinned set, and (when present) SBOM ↔ in-toto attestation. This site
// keeps the SBOM at dist/sbom.spdx.json and the attestation at
// dist/attestation.intoto.json, so the kit's neutral defaults (ROOT=., DIST=dist)
// apply unchanged. Re-pin the kit: npm run vendor:kit.
process.env.ROOT ??= ".";
process.env.DIST ??= "dist";
await import("../vendor/conformance-kit/gates/sbom/check-sbom.mjs");
