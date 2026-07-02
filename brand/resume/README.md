# Résumé — static asset

A self-contained, on-brand résumé for **Robert DeLanghe**, built on the Bounded
Systems design system. One source of truth → every surface: edit the JSON,
regenerate, and the HTML / Markdown / JSON-LD can't fall out of sync.

```
resume/
├── resume.json     ← SOURCE OF TRUTH (loosely JSON Resume schema)
├── resume.html     ← generated · embeds schema.org JSON-LD · self-hosted brand fonts
├── resume.md       ← generated · plain Markdown
├── resume.ld.json  ← generated · standalone schema.org Person (JSON-LD)
├── resume.css      ← screen + print stylesheet (every colour is a token)
└── resume.pdf      ← rendered from the HTML (gitignored; built by CI / on demand)
```

`resume.json` is the only file you edit by hand. The rest are generated.

```bash
npm run resume:build   # resume.json → resume.{html,md,ld.json}
npm run resume:check   # fail if any generated file is stale, then run asset tests
npm run resume:pdf     # render resume.html → resume.pdf (needs Chrome)
```

## Why build it instead of fixing print CSS on the live site

The original PDF was the browser printing `robertdelanghe.dev/resume`, so it
carried the browser's own chrome — the date/time header (`6/23/26, 7:41 AM`),
the page URL, and a `Page 1 of 3` footer baked into every page. Those are
injected by the print dialog, not the page, so no amount of site CSS removes
them cleanly.

This asset owns its own page box instead (`resume.css`):

- **`@page { size: Letter; margin: 14mm 16mm }`** — real margins.
- `break-inside: avoid` on each entry + `break-after: avoid` on section labels,
  so an org never splits from its bullets across a page break.
- `print-color-adjust: exact`, so the forest header bar survives the print pipe.

And `render-resume.mjs` drives headless Chrome with **`--no-pdf-header-footer`**,
so the rendered `resume.pdf` has none of the chrome the old export had.

## Print to a clean PDF (by hand)

Open `resume.html` and print (⌘P / Ctrl-P):

1. **Destination:** Save as PDF
2. **Paper:** Letter
3. **Options → Headers and footers:** **off** ← removes date / URL / "Page X of Y"
4. **Background graphics:** **on** ← keeps the forest header bar

…or just run `npm run resume:pdf`, which does the equivalent headlessly.

## Tests

`tools/resume-check.mjs` (run by `npm run resume:check`, gated in
`.github/workflows/resume.yml`) asserts the invariants that make this a
*bounded* document — it can't silently drift or rot:

- every linked stylesheet resolves; **zero raw hex** in `resume.css` (colour
  comes from tokens); no dangling `var(--…)` references
- the print rules (`@page`, `size: Letter`, `print-color-adjust`,
  `break-inside`) are present
- structure & content: required sections, every org/school, a `mailto:` contact,
  no empty/placeholder (`#`) links
- the inlined header mark matches `mark/mark-white.svg` (can't drift)
- Markdown and JSON-LD mirror the source; the HTML's embedded JSON-LD equals
  `resume.ld.json`
- (in CI) the rendered PDF is a valid, sanely-paginated document

## Design-system provenance

`resume.html` links the brand sources directly — no copies, no drift:

```
../css/fonts.css     self-hosted Space Grotesk + IBM Plex Mono (no CDN)
../tokens/tokens.css design tokens — every colour is var(--bs-color-*)
../css/base.css      resets + element defaults
./resume.css         this surface's layout + print rules
```

## Preview locally

```bash
python3 -m http.server 8080
# open http://localhost:8080/resume/resume.html
```

## Notes

- The header links (`GitHub`, `Writing`, `bounded.tools`, email) and the
  canonical URL are inferred from the source PDF's text. **Verify them in
  `resume.json`** before publishing.
- "Unfold" (mentioned as a JSON-LD generator) wasn't used — the JSON-LD here is
  a hand-rolled schema.org `Person` generated from `resume.json`, to avoid an
  external dependency. If you specifically want Unfold's output format, say so
  and I'll adapt the generator.
