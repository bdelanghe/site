# data/audit — content-audit inputs

Inputs for the deterministic copy-hygiene gate, run by the **shared, owned** auditor
[`@bounded-systems/string-audit`](https://github.com/bounded-systems/string-audit). The
prose + grounding logic lives upstream; this site calls the library's reusable workflow
(`.github/workflows/audit.yml` → `uses: bounded-systems/string-audit/...@v0.4.0`) and
passes the three files below. Fix a rule once upstream, bump the pinned ref, every
consuming site inherits it — one place to drive content discipline across sites.

| File | Authored by | What it is |
|---|---|---|
| `catalog.json` | **generated** (`npm run audit:catalog`) | Every shipped string as a typed symbol `{ type, value }`. Derived from `data/profile.json` + `data/site.json` (+ `data/highlight-copy.json` overrides). **Do not hand-edit** — edit the contracts and regenerate. |
| `grounding.json` | **curated** | The fact registry: the only metrics a `claim` may assert. An allowlist of attested numbers. |
| `attested-claims.json` | **curated** | Coverage-claim allowlist: absolute phrases (e.g. "every privileged effect") confirmed defensible (enforced-by-construction + linked in `proof[]`). Matching `overclaim` findings are demoted out of the blocking tier. |

## The gate

The upstream auditor runs two checks under `--strict`, both blocking:

| Check | Blocks on |
|---|---|
| Prose | `error`-level prose findings — chatbot artifacts, placeholders, lorem ipsum, **un-attested** absolutes. Attested overclaims, warns (em-dash cadence, tricolon) and suggestions (readability) are report-only. |
| Grounding | any `claim` metric not in `grounding.json`. |

CI (`.github/workflows/audit.yml`) regenerates the catalog (`node audit-catalog.mjs`) and
runs the gate on PRs touching the contracts, the registries, or the catalog generator.
Locally, `npm run audit:catalog` regenerates `catalog.json`; the gate itself runs in CI.

## Why grounding + attestation are separate and hand-curated

A `claim`'s number must be in `grounding.json`; an absolute coverage phrase must be in
`attested-claims.json`. Both are **independent human attestations**, not auto-derived from
the copy (which would let any claim ground itself). The rule: **a new metric or a new
absolute coverage claim must be added to its registry, deliberately** — "yes, this is real
and I can defend it." That is the gate: you can't ship an unbacked number or an unscoped
absolute without first attesting it. Same "attest, don't suppress" model throughout.
