#!/usr/bin/env node
// Thin shim → the vendored, hash-pinned canonical implementation in
// vendor/integrity/ (from bounded-systems/site/integrity/). Runs from the repo
// root so the canonical script's cwd-relative `dist` resolves here.
// Re-vendor: npm run vendor:integrity. See vendor/integrity/provenance.json.
import "../vendor/integrity/scripts/gen-sitemanifest.mjs";
