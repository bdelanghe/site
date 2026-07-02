# Spike: CSS framework determinism

Exploration only — **not** part of the shipped design system. Lives on
`spike/css-frameworks`, not `main`. The keepers (tokens, coverage/content/meta/a11y
checkers) stay on main; this branch holds framework-binding experiments + evidence.

## The axis that matters

"Determinism" for atomic CSS decomposes into three guarantees; tools differ on which they give:

1. **Merge/cascade determinism** — two utilities set the same property: is the winner fixed regardless of bundle/scan/insertion order? (the real footgun)
2. **Vocabulary determinism** — is class→CSS a bounded, config-fixed set?
3. **Output reproducibility** — byte-stable output across runs.

| Tool | #1 merge | #2 vocab | #3 repro | Notes |
|---|---|---|---|---|
| **StyleX** | ✅ strongest | ✅ | ✅ | conflict resolved at the call site (`stylex.props(a,b)` → b wins, period). React/JS-centric authoring. |
| **Griffel** | ✅ | ✅ | ✅ | StyleX peer (`mergeClasses`), smaller ecosystem. |
| **Panda** | ⚠️ layer/recipe yes; shorthand/longhand depends on file order | ✅ | ✅ | mitigates via `@layer` + `prefer-longhand` lint, not a hard merge invariant. |
| **Vanilla Extract** | ⚠️ composed conflicts follow stylesheet order | ✅ (Sprinkles bounded vocab) | ✅ | framework-agnostic `.css.ts`, zero-runtime. Strong on #2/#3. |
| **UnoCSS** | ❌ scan/insertion order; layers opt-in | ❌ unbounded (arbitrary values) | ⚠️ | what we'd been leaning toward — wrong axis. |
| **Tailwind v4** | ❌ cross-class by generated order (`tailwind-merge` bolt-on) | ⚠️ | ✅ | lateral move vs Uno on #1. |

## Verdict for this stack

The merge footgun is **adopted by going atomic** — it only bites when atomic utilities
from different sources conflict. Our static surfaces author the cascade explicitly
(semantic CSS + tokens), so they're already at max cascade determinism; the coverage
gate enforces the token vocabulary. So:

- **Static surfaces (now):** adopt nothing. Most deterministic option.
- **A real component app:** **StyleX** — determinism as a contract, matches the Zod/invariant mindset (accept JS/React authoring), **or Vanilla Extract** if framework-agnostic + zero-runtime matters more than call-site merge.
- The brand **tokens are the durable, framework-agnostic asset** (`tokens.flat.json`); `tokens.stylex.mjs` / `tokens.vars.css.ts` bind each framework to the existing `--bs-*` layer.

## The discriminating test

`determinism-test.mjs` proves the footgun concretely: two classes set the same
property from two files; the winner **flips with import order** (headless Chrome,
computed style). Run the equivalent with a real StyleX/VE build to confirm the
winner holds *for your build paths* — evidence, not docs.
