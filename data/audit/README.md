# data/audit — content-audit inputs

Inputs for the deterministic copy-hygiene gates, which import the prose checks from the
**shared, owned** auditor [`@bounded-systems/string-audit`](https://github.com/bounded-systems/string-audit)
(pinned as the `string-audit/` submodule, same pattern as `brand/`). We import `prose.mjs`
**directly** — its only deps are two public-npm packages — so the gates run locally,
egress-free. We deliberately don't run the library's `audit.mjs` / `store.mjs`, which pull
JSR deps (`cas` / `anchored-chain`) a restrictive network policy blocks. Fix a prose rule
once upstream, bump the submodule, both sites inherit it.

| File | Authored by | What it is |
|---|---|---|
| `catalog.json` | **generated** (`npm run audit:catalog`) | Every shipped string as a typed symbol `{ type, value }`. Derived from `data/profile.json` + `data/site.json` (+ `data/highlight-copy.json` overrides). **Do not hand-edit** — edit the contracts and regenerate. |
| `grounding.json` | **curated** | The fact registry: the only metrics a `claim` may assert. An allowlist of attested numbers. |
| `attested-claims.json` | **curated** | Coverage-claim allowlist: absolute phrases (e.g. "every privileged effect") confirmed defensible (enforced-by-construction + linked in `proof[]`). Matching `overclaim` findings are demoted out of the blocking tier. |

## The gates

| Gate | Script | Blocks (`--strict`) on |
|---|---|---|
| Prose | `npm run check:prose` | `error`-level prose findings — chatbot artifacts, placeholders, lorem ipsum, **un-attested** absolutes. Attested overclaims, warns (em-dash cadence, tricolon) and suggestions (readability) are report-only. |
| Grounding | `npm run check:grounding` | any `claim` metric not in `grounding.json`. |

`npm run check:content` runs both. CI (`.github/workflows/string-audit.yml`) runs both with
`--strict` on PRs touching the contracts, the registries, or the gate scripts.

## Why grounding + attestation are separate and hand-curated

A `claim`'s number must be in `grounding.json`; an absolute coverage phrase must be in
`attested-claims.json`. Both are **independent human attestations**, not auto-derived from
the copy (which would let any claim ground itself). The rule: **a new metric or a new
absolute coverage claim must be added to its registry, deliberately** — "yes, this is real
and I can defend it." That is the gate: you can't ship an unbacked number or an unscoped
absolute without first attesting it. Same "attest, don't suppress" model throughout.
