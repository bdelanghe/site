#!/usr/bin/env node
// Thin shim → the vendored, hash-pinned canonical implementation in
// vendor/integrity/ (from bounded-systems/site/integrity/). bd-site sets no
// PROVENANCE_DOC_URL, so the caveat matches this site's wording.
// Re-vendor: npm run vendor:integrity. See vendor/integrity/provenance.json.
import "../vendor/integrity/scripts/gen-provenance.mjs";
