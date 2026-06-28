# HTTP correctness probe — RFC 9110 at the edge (post-deploy)

`vendor/conformance-kit/integrity/http-probe.mjs` is a **post-deploy** probe that asserts the deployed
origin speaks HTTP correctly per **RFC 9110** (and **9111** for conditional caching). It is
the HTTP-semantics counterpart to `verify-site.mjs`:

- `verify-site.mjs` checks the **signed bytes** (does prod serve exactly the signed build?).
- `http-probe.mjs` checks the **HTTP semantics** (does the edge *behave* correctly?).

It needs a live URL, so it is **not a build gate** — it runs in `.github/workflows/deploy.yml`
**after** the site is live, right after the cryptographic verifier, and is **fail-closed**
(any wrong status/type/parity/conditional behaviour exits 1). Dependency-free (`fetch` only).

The routes are an **input** to the site-agnostic kit probe (nothing is hardcoded) —
supplied via `PROBE_CONFIG` (this site's `contract/http-probe.json`):

```
PROBE_CONFIG=contract/http-probe.json node vendor/conformance-kit/integrity/http-probe.mjs https://robertdelanghe.dev
```

## What it asserts

| # | RFC | Check |
|---|---|---|
| 1 | 9110 §15 | each indexable route → `200`; a known-missing path → `404`. |
| 2 | 9110 §8.3 | `Content-Type` is correct (HTML→`text/html`, `robots.txt`→`text/plain`+charset, `sitemap.xml`/`feed.xml`→`xml`, `feed.json`/`site.webmanifest`→`json`). |
| 3 | 9110 §9.3.2 | **HEAD parity** — `HEAD` mirrors `GET`'s status + `Content-Type` and returns **no body**. |
| 4 | 9111 §4.3 / 9110 §13.1.2 | **conditional** — when `GET` returns an `ETag`, a follow-up `If-None-Match` yields `304` with no body. Skipped *with a note* if the edge serves no `ETag`. |
| 5 | 9110 §15.5.5 | **404 handling** — the unknown path serves the site's 404 document (`text/html`). |
| 6 | 9110 §15.4 | **redirects terminate** — any `3xx` chain reaches a terminal `2xx` within a hop cap (no loops); the canonical apex must not itself redirect. |

## Notes on the live edge

- **HTML charset** is *recommended*, not required: the HTML declares it in-band via
  `<meta charset>`, and Cloudflare's asset edge omits `charset` on `text/html`. The probe
  **notes** this rather than failing (it still requires a charset on `text/plain`, where
  there is no in-band declaration).
- **Placement** — the probe is a tool of the vendored **conformance kit**
  (`vendor/conformance-kit/integrity/http-probe.mjs`), hash-pinned in the kit's file set
  (`scripts/vendor-integrity.mjs` → `vendor/conformance-kit/provenance.json`). It is
  site-agnostic: the routes it probes are NOT hardcoded but supplied by this site's
  `contract/http-probe.json` (an input), exactly like the SHACL shapes and structure
  baseline. New HTTP-correctness checks belong upstream in the kit; new routes belong in
  this site's `contract/http-probe.json`.
