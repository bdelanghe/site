# Accessibility — what's gated, what's claimed

The Lighthouse gate (`.github/workflows/lighthouse.yml` + `lighthouserc.json`) asserts a
perfect Lighthouse **accessibility score (100/100)** on every PR. That is a **regression
signal over a subset of automatable checks — not an accessibility standard or a conformance
claim.**

## Reporting

Report exactly:

> Lighthouse accessibility remained at 100/100. Automated accessibility checks found no
> serious or critical violations.

Do **not** state **"Meets WCAG 2.2 AA"** (or "accessible") on the strength of Lighthouse
alone — that's an overclaim, the same kind `copy-review.mjs` / `string-audit` exist to
catch. The claim requires a full WCAG audit *including manual testing* (tracked separately).

## The hierarchy that actually matters

1. **WCAG 2.2 Level AA** — the primary target; satisfy every Level A + AA success criterion
   (perceivable, operable, understandable, robust).
2. **Manual functional testing** — more important than a perfect automated score:
   keyboard-only navigation; visible + logical focus order; screen-reader labels, landmarks,
   headings, announcements; forms with understandable labels + errors; 200% zoom + narrow
   reflow; color-independent meaning + adequate contrast; reduced-motion support; accessible
   dialogs, menus, tabs, and other interactive widgets.
3. **Correct HTML + ARIA semantics** — follow the WAI-ARIA Authoring Practices Guide, but
   prefer **native HTML**; incorrect ARIA actively misrepresents the UI to assistive tech.
4. **Jurisdiction**, when applicable — US federal: Section 508 (WCAG 2.0 A/AA); US state &
   local: ADA Title II (WCAG 2.1 AA); EU ICT: EN 301 549.

## What the automated checks here actually cover

- **`lone`** blesses each rendered post's DOM (semantic HTML + a11y checks); error-severity
  findings block the build.
- **`@bdelanghe/brand`** verifies design-token **contrast** ratios meet WCAG AA
  (`brand/tools/a11y.mjs`) — once, in the design system.
- **Lighthouse** is the runtime backstop on the composed page.

These catch *regressions*. They do not establish *conformance* — that's what the WCAG 2.2 AA
audit task is for.
