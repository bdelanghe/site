# Bounded Systems — Brand

Identity assets and design tokens for **Bounded Systems**.
*Bounded authority for AI agents — drawn at the door, not the process or container.*

The mark is the capability model made physical: a **room** (the boundary), a
**door** (the gap — one sanctioned unit of authority), and an **agent** (the
guest, sitting low near the door).

```
brand/
├── tokens/
│   ├── tokens.json        ← SOURCE OF TRUTH (W3C design tokens)
│   ├── tokens.css         ← generated CSS variables + text styles (do not hand-edit)
│   └── build-tokens.mjs   ← generator; `--check` fails CI on drift
├── css/                   ← ready-to-link stylesheets for web consumers
│   ├── fonts.css          ← @font-face Space Grotesk + IBM Plex Mono (self-hosted)
│   ├── fonts/             ← the woff2 files (OFL, latin subset) — no external CDN
│   └── base.css           ← resets + element defaults on the tokens
├── mark/                  ← logo only, transparent
│   ├── mark-white.svg     ← on forest / dark
│   ├── mark-forest.svg    ← on light
│   └── *-1024.png
├── avatar/                ← square masters (surfaces mask to rounded/circle)
│   ├── avatar-forest.svg  ← recommended
│   ├── avatar-light.svg
│   └── avatar-{forest,light}-{200,280,420,460,1024}.png
├── lockup/                ← wide link-card lockup (OG 1.91:1, 1200×630)
│   ├── lockup-forest.svg  ← repo social preview
│   └── lockup-light.svg
├── favicon-32.png
├── style-dictionary.config.mjs  ← native / Figma outputs → dist/ (gitignored)
└── package.json           ← build:css · check · build:sd
```

## Tokens

`tokens.json` is the only file you edit. Everything else is generated.

```bash
node tokens/build-tokens.mjs          # regenerate tokens.css
node tokens/build-tokens.mjs --check  # exit 1 if tokens.css is stale (CI)
```

Wire the check into the pipeline so the CSS can never drift from the JSON:

```yaml
# .github/workflows/tokens.yml (sketch)
- run: node brand/tokens/build-tokens.mjs --check
```

### Layers

| Layer | What | Example |
| --- | --- | --- |
| **Primitive token** | one named value | `color.forest` = `#0C5A42` |
| **Text style** (composite) | a recipe bundling primitives | `text.label` → mono + 11px + `0.14em` + uppercase |
| **Component** | the mark, built from tokens | `mark/*.svg` |

The **slug / eyebrow** ("AVATAR SYSTEM · v1") is the `text.label` style — *not*
a single token, but a composite that references `font.mono`, `size.text-label`,
etc. Consume it as the `.bs-text-label` class or read its parts from JSON.

## Consuming

**CSS / web** — import the generated variables and styles:

```css
@import "brand/tokens/tokens.css";
.eyebrow { } /* or just add class="bs-text-label" */
h1        { color: var(--bs-color-ink); }
```

**Anything that can't read CSS** (native iOS/Android, email, Figma, print) reads
`tokens.json` directly, or builds a platform output from it via Style Dictionary:

```bash
npm install
npm run build:sd   # → dist/{tokens.scss,tokens.js,tokens.flat.json,Tokens.swift,tokens.xml}
```

`tokens.css` stays the curated **web** artifact (it carries the composite
`.bs-text-*` classes); Style Dictionary covers everything else. `dist/` is
gitignored — it's generated, never committed. JSON is the source; every CSS,
SCSS, JS, Swift, and XML file is a derived artifact.

**As a package** — depend on `@bounded-systems/brand` (npm) and import by path:

```js
import tokens from "@bounded-systems/brand/tokens.json" with { type: "json" };
```
```css
@import "@bounded-systems/brand/tokens.css";
```

### Deployed token bundle (a contract, not a dump)

`npm run tokens:dist` assembles `dist/tokens-site/` and `deploy-tokens.yml`
publishes it to a stable URL on every release. The bundle is a **versioned,
content-addressed contract**:

```
tokens-site/
├── manifest.json     ← the contract — validates against tokens/manifest.schema.json
├── tokens.json       ← canonical DTCG source  (application/design-tokens+json)
├── tokens.css        ← CSS variables           (text/css)
├── tokens.scss · tokens.js · tokens.flat.json · Tokens.swift · tokens.xml
```

`manifest.json` declares every projection with its IANA **media type** and
**SHA-256**, plus the package `version` and (in CI) the source `commit`. A
consumer fetches the manifest, picks a format, and **verifies the bytes by hash**
— integrity over freshness. `node tools/build-tokens-dist.mjs --check` gates
[DTCG] conformance and the contract shape in CI, so the deployed surface can't
drift from the spec.

Fonts: [Space Grotesk] + [IBM Plex Mono] (Google Fonts).

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| `forest` | `#0C5A42` | primary fill, mark on light |
| `forest-deep` | `#073D2C` | pressed / deep |
| `forest-tint` | `#E2EBE6` | subtle tinted surface |
| `forest-soft` | `#D2E0D8` | fills / borders on tinted surfaces |
| `paper` | `#EDEAE1` | app background, warm |
| `card` | `#FFFFFF` | card surface (aliases `white`) |
| `card-alt` | `#F4F1EA` | light avatar fill |
| `ink` | `#16221C` | primary text |
| `ink-soft` | `#5C6B63` | secondary text |
| `ink-mono` | `#5E6B62` | mono label / slug text (WCAG-AA on paper) |
| `line` | `#E4E0D4` | hairline borders |
| `white` | `#FFFFFF` | mark on forest |
| `clay` | `#A6432F` | accent / negative |
| `clay-tint` | `#F2DED8` | negative surface |
| `amber` | `#B5762A` | caution / highlight |
| `amber-tint` | `#F3E8D6` | caution surface |

### Grade colors

Status colors for graded claims (*Enforced* · *Partial* · *Aspirational*). Only
the **base** is authored in `tokens.json`; `build-tokens.mjs` derives the `-bg`
(light surface), `-fg` (readable text), and `-on-dark` ramps deterministically,
so consumers get the full set as `--bs-grade-*` variables.

| Token | Hex | Use |
| --- | --- | --- |
| `grade-enforced` | `#3FB984` | proven / enforced in running code |
| `grade-partial` | `#C8902F` | partially enforced |
| `grade-aspirational` | `#7E8C83` | aspirational / not yet enforced |

## Token accessibility

Token-level accessibility is a gated contract, not a vibe. The brand vendors the
**Token Accessibility suite** from [`bounded-systems/conformance-kit`](https://github.com/bounded-systems/conformance-kit)
(hash-pinned in `vendor/conformance-kit/`, PR #25), and one config —
`tokens/token-a11y.json` — drives every member over the generated `tokens.css`:

| Member | Checks | WCAG |
| --- | --- | --- |
| **palette** | CVD-safe contrast (deutan/protan/tritan), APCA, non-text | 1.4.3 / 1.4.11 |
| **pairing** | derives fg×bg pairings from the brand CSS ∪ declared set (report-only superset) | — |
| **typography** | body line-height ≥1.5, overridable spacing, min size, weight×size | 1.4.12 / 1.4.4 / 1.4.8 |
| **target-size** | interactive-target tokens ≥24×24; ≥44 status | 2.5.8 AA / 2.5.5 AAA |
| **opacity** | EFFECTIVE composited contrast of any translucent foreground | 1.4.3 / 1.4.11 |
| **likeness** | near-duplicate hygiene + categorical distinctness (normal + CVD) | 1.4.1 |

```bash
npm run token-a11y         # verify the vendor hash-pin, then run the whole suite
npm run token-a11y:check   # rebuild tokens.css first, then run (the CI entrypoint)
npm run token-a11y:verify  # only verify the vendored suite against its hash-pin
```

Fail-closed (`exit 1`) on any gated-member failure. **No exemptions** — hairlines,
dividers, and separators are declared `ui` and must clear 3:1; accessible for
everyone. CI: `.github/workflows/token-a11y.yml`.

### Interactive-target (control) tokens

So every surface has an accessible pointer-target token to reach for (WCAG 2.5.8):

| Token | Value | Use |
| --- | --- | --- |
| `control-min-tap-target` | `24px` | SC 2.5.8 (AA) floor — apply as `min-width`/`min-height` on any control |
| `control-sm` | `36px` | compact control (chips, dense toolbars) |
| `control-md` | `44px` | default control — also meets 2.5.5 (AAA, 44px) |
| `control-lg` | `52px` | prominent / primary control |

## Avatar usage

- Upload **`avatar/avatar-forest-460.png`** as the GitHub org avatar (or the SVG
  master). GitHub masks to rounded-square / circle itself — the mark sits inside
  a ~16% safe area so the door never clips.
- Forest is the hero treatment. Light is for placing on dark/photographic backgrounds.
- Don't recolor the mark, rotate it, add effects, or close the door gap.
- Below 20px, prefer `favicon-32.png`.

## Link cards / social preview

The square avatar center-crops badly on wide (~1.91:1) social/link cards and
clips the door. Use the dedicated wide lockup instead:

- Set **`lockup/lockup-forest-1200.png`** as the repo's social preview
  (Settings → Social preview). `lockup-light-*` is for light/photographic contexts.
- 1200×630 (OG), mark + wordmark + slug + tagline, with safe margins.
- SVG masters carry live text; the `*-1200.png` rasters (Space Grotesk + IBM Plex
  Mono baked in) are what social/link cards should point at — most platforms
  (Slack, X, iMessage) won't render an SVG OG image.

[Space Grotesk]: https://fonts.google.com/specimen/Space+Grotesk
[IBM Plex Mono]: https://fonts.google.com/specimen/IBM+Plex+Mono
[DTCG]: https://tr.designtokens.org/format/
