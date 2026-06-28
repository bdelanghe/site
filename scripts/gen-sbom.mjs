#!/usr/bin/env node
// Site config shim → the vendored, hash-pinned conformance-kit SBOM generator
// (vendor/conformance-kit/gates/sbom/gen-sbom.mjs). The kit tool is site-agnostic;
// this injects THIS site's inputs (document name/namespace/creators + the exact set
// of npm lockfiles whose packages make up the supply chain) and delegates. The Nix
// flake.lock is read by the kit automatically when present.
//
// Emits dist/sbom.spdx.json (SPDX-2.3). Re-pin the kit: npm run vendor:kit.
process.env.ROOT ??= ".";
process.env.DIST ??= "dist";
process.env.SBOM_NAME ??= "robertdelanghe.dev-sbom";
process.env.SBOM_NAMESPACE_BASE ??= "https://robertdelanghe.dev/sbom";
process.env.SBOM_CREATORS ??= "Tool: gen-sbom.mjs,Organization: Bounded Systems";
process.env.SBOM_LOCKFILES ??= [
  "package-lock.json",
  "vendor/conformance-kit/integrity/verify/package-lock.json",
  "vendor/conformance-kit/integrity/structure-audit/package-lock.json",
].join(",");
await import("../vendor/conformance-kit/gates/sbom/gen-sbom.mjs");
