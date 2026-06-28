#!/usr/bin/env node
// Thin shim → the vendored, hash-pinned canonical implementation in the conformance
// kit (vendor/conformance-kit/integrity/gen-sitemanifest.mjs). Runs from the repo
// root so the canonical script's cwd-relative `dist` resolves here. The kit's EXCLUDE
// set is a superset of both reference sites' provenance sidecars (incl. _headers), so
// no MANIFEST_EXCLUDE is needed.
// Re-vendor: npm run vendor:kit. See vendor/conformance-kit/provenance.json.
import "../vendor/conformance-kit/integrity/gen-sitemanifest.mjs";
