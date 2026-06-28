# SEO gate — discoverability as an enforceable contract

SEO advice is usually a checklist you *hope* you followed. This gate makes the site's
technical discoverability an **enforceable contract** over the **built `dist/`**:
the vendored conformance-kit gate `vendor/conformance-kit/gates/seo-gate.mjs` (`npm run check:seo`) reads only the built bytes and **fails the
build (exit 1)** on any violation. It runs in `npm run build` (right after `node build.mjs`)
and in CI via `.github/workflows/seo.yml`.

It is pure + offline (no network), the same discipline as `build.mjs` and the SHACL gate.

## What it enforces

| Check | Rule |
|---|---|
| **canonical** | every indexable page has **exactly one** `<link rel="canonical">`, and it is **self-consistent** — the canonical URL maps back to *this* file (`/resume` ↔ `resume.html`). All canonicals share one origin. |
| **title** | non-empty `<title>`, **unique** across pages. |
| **description** | non-empty `<meta name="description">`, **unique** across pages. |
| **noindex** | no indexable page carries an accidental `robots: noindex`. The `404.html` page is the only page allowed (and *required*) to be `noindex`. |
| **robots.txt** | parses per **RFC 9309**: groups start with `user-agent` line(s); `allow`/`disallow` never precede a user-agent; `Sitemap` values are absolute URLs; the advertised sitemap resolves to a built file. Unrecognised fields are ignored (RFC 9309 §2.2.4). |
| **sitemap.xml** | every `<loc>` resolves to a built page (canonicalised), and shares the site's single origin. |
| **links** | zero broken internal links across all pages. |

## Indexable vs error pages

The 404 page is special: it is correctly `noindex`, has no canonical, and no description.
The gate treats `404.html` as the one non-indexable page — it is *required* to be `noindex`
and is exempt from the canonical/title/description rules.

## Link resolution (mirrors structure-audit)

Internal links resolve with the same path semantics as the vendored
`structure-audit/audit.mjs` (`file` → `file.html` → `file/index.html`), and the same
deploy-time **sidecar** allowlist (`/rekor`, `/provenance.json`, `/site.sha256`,
`/resume.pdf`, `/attestation.intoto.json`) — these are written by the deploy workflow, not
the hermetic build, so a link to one is resolvable rather than dead. The logic is
**re-implemented** (regex over HTML) rather than imported, to keep the gate zero-dep
(structure-audit pulls in `linkedom` + `@mozilla/readability`).

## What it does NOT check

- **Ranking / keyword quality** — this is *technical* SEO (the machine-readable contract),
  not content strategy.
- **Off-page signals** (backlinks, etc.) and **rendered-vs-source** parity at the edge —
  the post-deploy HTTP probe (`vendor/conformance-kit/integrity/http-probe.mjs`) covers edge behaviour.
