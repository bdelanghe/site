# CommonMark gate — pin the posts renderer, prove it escapes raw HTML

`posts.mjs` (`renderMarkdown`) is a deliberately **small, safe subset** of
[CommonMark](https://commonmark.org): no raw-HTML passthrough, no nested-block recursion.
`scripts/commonmark-gate.mjs` (`npm run check:commonmark`) keeps that renderer honest. It
**fails the build (exit 1)** on drift or an HTML leak, runs in `prebuild`, and in CI via
`.github/workflows/seo.yml`. It is pure (it imports the renderer and runs fixtures — no
`dist/` needed).

## Two things it asserts

1. **Conformance (snapshots).** For the constructs the renderer supports — ATX headings
   (`##`/`###`, with a stray `#` h1 demoted to h2), `*emphasis*` / `**strong**`, `` `code` ``
   spans, `[links](url)`, tight bullet lists, and `&`/`<`/`>` escaping — the gate asserts the
   output equals the **CommonMark-specified HTML**. Any change to `renderMarkdown` that alters
   these must update the snapshot deliberately.
2. **Safety.** Hostile raw HTML (`<script>`, `<img onerror=…>`, `javascript:` URLs, `<iframe>`)
   is fed in, and the gate asserts every tag is **escaped** — no live tag from the input
   survives. Only the renderer's own tag set (`p h2 h3 ul li blockquote hr code a strong em`)
   may appear in the output of a hostile input.

## Documented deviations from strict CommonMark

These are intentional and asserted via the SUBSET snapshots — they are **not** bugs:

- **Raw HTML is escaped, not passed through.** CommonMark renders HTML blocks verbatim; this
  renderer escapes them. That is the safety hardening above (the site has no trusted-HTML
  authoring path — posts are markdown only).
- **Thematic break** renders as the HTML5 void `<hr>` (not `<hr />`). Semantically identical.
- **Single-block blockquotes/headings** are not wrapped in an inner `<p>`.

If the renderer is ever extended toward fuller CommonMark, promote the relevant SUBSET
fixtures into the CONFORMANCE set.
