# SHACL gate — JSON-LD as an enforceable contract

The site emits [schema.org](https://schema.org) JSON-LD (`application/ld+json`) so search
engines and other consumers can read its structured data. **Schema.org alone is flexible
guidance** — almost anything validates, and a typo or a dropped property fails silently. This
gate makes the structured data an **enforceable contract**: *Schema.org + SHACL.*

the vendored conformance-kit runner `vendor/conformance-kit/gates/shacl-runner.mjs`, given this site's `contract/jsonld.shapes.ttl` shapes + `dist/` (`npm run check:shacl`), extracts every JSON-LD block from the **built**
HTML in `dist/`, expands it to RDF, and validates it against the SHACL shapes in
`contract/jsonld.shapes.ttl`. **The build fails (exit 1) unless the SHACL report says
`conforms: true`**, printing every violation. It runs in CI via `.github/workflows/shacl.yml`.

This is the semantic-data member of the contract family, alongside the content schemas
(`contract/*.schema.json`), the brand design tokens, the `lone` DOM-semantics gate, the
atomic `copy-gate`, and Lighthouse.

## What the site emits (and what the shapes enforce)

The shapes are matched to **what `build.mjs` actually emits** — verified against real `dist/`
output. A property is required only where the site genuinely provides it.

| Page | JSON-LD type | Enforced (required) properties |
|---|---|---|
| `/`, `/resume` | `schema:Person` | `name` (string), `url` (IRI) — via `PersonShape` |
| `/`, `/resume` | `schema:Person` (full profile) | `jobTitle`, `description`, `knowsAbout` — via `ProfilePersonShape` |
| `/blog/<slug>` | `schema:BlogPosting` | `headline`, `description`, `datePublished` (ISO `YYYY-MM-DD`), `url` (IRI), `mainEntityOfPage` (IRI), `inLanguage`, `author` (Person), `publisher` (Organization) |
| nested | `schema:Organization` | `name` (`alumniOf`, `publisher`) |
| nested | `schema:CreativeWork` | `name`, `url` (IRI) (`subjectOf`, `citation`) |

`/provenance` and `/blog` (the index) emit no JSON-LD; the gate tolerates pages with zero blocks.

### Two Person shapes, on purpose

A `BlogPosting`'s `author` is also a `schema:Person`, but it carries only `name` + `url` — no
`jobTitle`/`description`. So:

- **`PersonShape`** (`sh:targetClass schema:Person`) requires only `name` + `url` — true of
  *both* the profile Person and the author.
- **`ProfilePersonShape`** (`sh:targetSubjectsOf schema:knowsAbout`) requires the richer
  `jobTitle`/`description`/`knowsAbout`. Only the homepage/résumé Person carries
  `knowsAbout`, so this contract applies to the profile node **only** — the author Person is
  not wrongly failed.

## Deterministic & offline

`build.mjs` emits `"@context": "https://schema.org"`. Expanding that normally dereferences the
remote context over the network — non-deterministic and unavailable in hermetic CI. The gate
instead serves a tiny **local** context via a custom `documentLoader`: `@vocab` maps every
type/property name to a stable `https://schema.org/` IRI, and `url`/`sameAs`/`mainEntityOfPage`
coerce to IRIs. `datePublished` stays a plain string literal — matching exactly what the site
emits (the JSON-LD applies no date typing). The gate never touches the network.

## What SHACL does NOT check (separate / manual)

SHACL enforces the **structural** contract — that the right types and properties are present
and well-formed. It deliberately does **not** verify:

- **Structured data matches the visible content.** SHACL checks that a `Person` has a
  `jobTitle`; it does not check that the `jobTitle` string equals the role shown on the page.
  Keeping structured data and visible copy in sync is a manual review concern.
- **Google Rich Results eligibility.** Passing SHACL does not guarantee a rich result.
  Validate eligibility manually with Google's
  [Rich Results Test](https://search.google.com/test/rich-results) when it matters.
