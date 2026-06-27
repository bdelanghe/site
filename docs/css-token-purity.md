# RFC: css-token-purity — no color escapes the design system

**Status:** Implemented (2026-06-27) · **Owner:** Robert DeLanghe · **Scope:** robertdelanghe.dev (and the wider Bounded Systems sites)

> **Live.** `scripts/check-css.mjs` runs inside `build.mjs` (so `node build.mjs` — every
> CI path — fails on a raw color), is exposed as `npm run check:css`, and its verdict is
> recorded as a signed `css-token-purity` predicate in the build attestation (§7). The
> §5 brand dependency is resolved: `baobab` shipped the `on-forest` token set and
> `styles.css` is at **zero** raw color literals, so the gate demands zero — no allowlist.

> The visual sibling of [atomic-copy](./atomic-copy.md). atomic-copy enforces *no
> hardcoded string*; this enforces *no hardcoded visual value*. atomic-copy.md already
> states the visual rule as settled baseline — "inline hex is a lint failure" — but for
> site CSS **that gate does not yet exist**: `brand/tokens/tokens.css` is drift-checked
> against `tokens.json` (`build-tokens.mjs --check`), yet `styles.css` is free to write a
> raw `rgba()`. It did, in three places (`.seeking__*`, white-on-forest), and the only
> thing that caught it was **Lighthouse — downstream, as an a11y score**, not the design
> system — upstream, as a contract. This RFC closes that gap.

## 1. The invariant

> **No visual value is embedded directly in site CSS. Every color is a brand token,
> referenced as `var(--bs-color-*)` — never written as a literal.** (Extensible to
> spacing / radius / type; see §9.)

The exact analogue of the copy rule:

| atomic-copy (verbal) | css-token-purity (visual) |
|---|---|
| No user-facing string inline; every string is a copy atom by id. | No literal color in CSS; every color is a `var(--bs-color-*)` token. |
| `@bounded-systems/string-audit` is the enforcing gate. | `check:css` (this RFC) is the enforcing gate. |
| One source of truth for the words. | One source of truth for the palette (`baobab` / `brand/tokens`). |

The payoff is identical: a color that isn't a token **can't ship, because there is
nowhere else a color can be written.** Today `styles.css` is already ~98% there — 147
`var(--bs-*)` references against 3 raw `rgba()`. This RFC makes the 3 impossible.

## 2. Why *this* gate and not the more ambitious one

Three candidate strengths were considered. The choice is governed by one principle: **a
gate should assert the strongest invariant that is still decidable.**

1. **Regex** — grep for `#hex` / `rgb()`. Deterministic but *not robust*: misses named
   colors, `hsl`/`oklch`, colors inside `background`/`box-shadow`/gradients;
   false-positives on hexes in comments and `url()`. An under-approximation that rots
   the first time someone writes `color: white`. **Rejected.**
2. **AST (PostCSS) + token-membership** — parse the CSS, assert no literal color in any
   color-valued position, and assert every `var()` resolves to a real token. Fully
   deterministic (the AST is a pure function of the bytes; membership is a set test) and
   *exhaustively robust within the decidable domain*. **Chosen.**
3. **Resolved-value / contrast** — resolve each `var()` to its computed value and check
   contrast. More *ambitious*, but **less determinate**: full custom-property resolution
   is context-dependent (cascade, scoped overrides, `@media`, and especially
   **compositing** — the bug was `rgba(white,0.6)` *over forest*, whose real value
   depends on the background element). Resolving it requires *rendering*, which leaves
   the static domain and reintroduces runtime variance. That is what Lighthouse already
   is. **Out of scope by design** (§4).

Robust and determinate both peak at #2; past it they pull apart. #2 sits exactly on the
functional-core / imperative-shell line: a decidable static invariant is the pure core;
contrast-in-context is the impure shell.

## 3. The two checks (both deterministic)

### 3.1 Color-purity (AST)
- Parse `styles.css` with PostCSS (+ `postcss-value-parser`).
- For every declaration whose property can carry a color (`color`, `background[-color]`,
  `border[-*]-color` / `border` shorthand, `outline`, `box-shadow`, `text-shadow`,
  `fill`, `stroke`, gradient functions, …), assert **no literal color** appears in any
  notation: hex, `rgb()/rgba()`, `hsl()/hsla()`, named colors, `oklch()/lab()/color()`.
- Allowed: `var(--bs-color-*)`, `currentColor`, `transparent`, `inherit` (see §9).
- Deterministic: the AST is a pure function of the input bytes.

### 3.2 Token-membership (set)
- Collect every `var(--bs-*)` referenced in `styles.css`.
- Assert each is a key defined in `brand/tokens/tokens.json` (the source of truth).
- Catches typos (`var(--bs-color-frost)`) and references to retired tokens — the gap
  pure AST-purity misses.
- Deterministic: set membership.

Together — structural purity **and** vocabulary membership — they are the strongest
decidable invariant: the CSS may only *speak in tokens*, and only *real* tokens.

## 4. Out of scope (deliberately): contrast

Contrast depends on composition, so it is statically undecidable here. It is **not
dropped — it is relocated** to where it *is* decidable:
- **`baobab` / brand** verifies the palette meets WCAG **once**, in the design system —
  including a missing **on-forest / on-dark** set (§5). Verified at the source, reused
  everywhere.
- **Lighthouse** is the runtime backstop for the *composed* result (the existing a11y =
  1.0 gate).

Three rings, each owning what it can decide: the gate makes raw values *impossible*; the
brand makes the *tokens* safe; Lighthouse catches *composition*.

## 5. Brand dependency: the on-forest token set

The three raw values exist because the brand's tokens are tuned for light backgrounds
(ink-on-paper); the seeking callout is a dark forest panel with **no token to use**, so
the site improvised translucent white. The gate **cannot demand zero raw values** until
`baobab` ships `--bs-color-on-forest` / `-muted` / `-subtle` (contrast-verified against
forest). Until then, `check:css` runs with a documented, shrinking allowlist containing
exactly those three declarations — and the allowlist is itself a gate: it may only
shrink.

## 6. Implementation

- `scripts/check-css.mjs` — PostCSS-based, deterministic, no network.
- Wire into `package.json`: add `check:css`, and chain it into `prebuild`
  (`npm run check && npm run check:schema && npm run check:css`) so a violation fails
  **before** `nix build` and deploy — earlier and cheaper than the Lighthouse catch.
- On failure: exit non-zero, print `styles.css:LINE` + the offending value, and (where
  inferable) the token that should replace it.
- Hermetic: pure function of `styles.css` + `tokens.json`; identical input → identical
  verdict; no ordering/timestamp variance.

## 7. Provenance ring (follow-on)

The deterministic nix build already emits a signed `attestation.json`
(`scripts/gen-attestation.mjs`, `ATTEST_KEY`). Add `check:css` as an **attested
predicate**: `{ "css-token-purity": "pass" }` alongside the input hashes. Then *"built
how we intended"* becomes third-party-verifiable — rebuild from the attested, pinned
source → identical bytes (reproducible) **and** the contract provably held (attested).
The gate **enforces**, the attestation **attributes**, the hermetic build lets anyone
**re-verify**. (Note: provenance does not *fail* builds — the gate does; provenance makes
the gate's verdict non-repudiable.)

## 8. Acceptance criteria

- [ ] `check:css` fails the build on any literal color in `styles.css` (all notations),
      reporting `file:line` + value.
- [ ] `check:css` fails on any `var(--bs-*)` absent from `tokens.json`.
- [ ] Passes on current `main` once the three `.seeking__*` values are tokenized
      (preferred) or explicitly allowlisted.
- [ ] Wired into `prebuild`; deploy cannot proceed past a violation.
- [ ] Deterministic: identical output across runs on identical input.
- [ ] (Follow-on) `attestation.json` carries the `css-token-purity` predicate.

## 9. Open questions [NEEDS CLARIFICATION]

- **Scope beyond color** — extend to spacing / radius / type literals now, or color-only
  first? (Color is where the a11y risk lives; the rest is consistency hygiene.)
- **Allowlist exemptions** — keep `currentColor` / `transparent` / `inherit` exempt?
  (Recommend yes; they are not palette decisions.)
- **Where it lives long-term** — site repo, or promoted into `baobab` so every Bounded
  Systems surface inherits it (the way `string-audit` is shared)?
- **Brand ownership** — who ships the on-forest token set, and when? It is the blocker
  to demanding *zero* raw values (§5).
