# data/audit — content-audit inputs for `string-audit`

Inputs for the **shared, owned** content auditor
[`@bounded-systems/string-audit`](https://github.com/bounded-systems/string-audit),
pinned as the `string-audit/` git submodule (same pattern as `brand/`). Fix a rule
once upstream, bump the submodule, and every site that consumes it inherits the change.

| File | Authored by | What it is |
|---|---|---|
| `catalog.json` | **generated** (`npm run audit:catalog`) | Every shipped string as a named, typed symbol `{ type, value }`. Derived from `data/profile.json` + `data/site.json` (with `data/highlight-copy.json` overrides). **Do not hand-edit** — edit the contracts and regenerate. |
| `grounding.json` | **curated by hand** | The fact registry: the only metrics a `claim` symbol is allowed to assert. An allowlist of attested numbers. |

## Why grounding is separate (and hand-curated)

`string-audit` types every string. A `claim` (any string carrying a number) is checked
against `grounding.json`: if a claim states a stat that isn't in the registry, the
auditor **flags** it — it never rewrites it as fact. That only has teeth if the registry
is an *independent* attestation, not auto-derived from the same copy (which would let
every claim trivially ground itself).

So the rule is: **a new metric in the copy must also be added here**, deliberately, as
"yes, this number is real and I can defend it." That is the gate — you cannot ship an
unbacked number without first attesting it.

## Run it

```sh
npm run audit:catalog   # regenerate catalog.json from the contracts (pure, offline)
npm run check:audit     # regenerate + run the live audit (needs string-audit's deps)
```

`check:audit` installs the submodule's deps (JSR registry — reachable in CI; may be
blocked by a local network policy) and runs `string-audit` over our catalog + grounding.
With `ANTHROPIC_API_KEY` set it runs the real LLM audit on cache-misses; without a key it
runs the deterministic, offline checks. CI runs it report-only
(`.github/workflows/string-audit.yml`).
