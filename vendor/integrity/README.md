# vendor/integrity

Vendored, **hash-pinned** copy of `bounded-systems/site/integrity/` — the shared
build-provenance tooling (subtree-split target). Same pattern as
`vendor/string-audit/`: not a submodule, pinned by `provenance.json`, verified
before use.

- `scripts/gen-sitemanifest.mjs`, `scripts/gen-provenance.mjs` — consumed by the
  thin shims in `../../scripts/`.
- `verify-site.mjs` — the independent verifier (`node vendor/integrity/verify-site.mjs https://robertdelanghe.dev`).
- `provenance.json` — source + commit + sha256 pin of each file.

Verify the pin: `npm run check:integrity` (runs in `prebuild`, fails closed on
drift). Re-vendor a newer commit: `npm run vendor:integrity -- --ref <sha>`.
