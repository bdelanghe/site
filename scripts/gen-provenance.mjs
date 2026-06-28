#!/usr/bin/env node
// Thin shim → the vendored, hash-pinned canonical implementation in the conformance
// kit (vendor/conformance-kit/integrity/gen-provenance.mjs). bd-site sets no
// PROVENANCE_DOC_URL, so the caveat matches this site's wording; $DIST defaults to
// ./dist resolved from cwd (the shim runs from the repo root).
// Re-vendor: npm run vendor:kit. See vendor/conformance-kit/provenance.json.
import "../vendor/conformance-kit/integrity/gen-provenance.mjs";
