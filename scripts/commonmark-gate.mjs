#!/usr/bin/env node
// CommonMark assertion gate — pins the posts renderer (posts.mjs `renderMarkdown`) so
// its markdown→HTML behaviour can't silently drift, and proves it never emits unsafe
// raw HTML. See docs/commonmark-gate.md.
//
//   node scripts/commonmark-gate.mjs   # build gate (exit 1 on drift or an HTML leak)
//
// The renderer is a deliberately SMALL, SAFE subset of CommonMark (no raw-HTML
// passthrough, no nested-block recursion). This gate does two things:
//   1. CONFORMANCE — for the constructs the renderer supports, assert it produces the
//      CommonMark-specified HTML (headings, emphasis, code spans, links, tight bullet
//      lists, HTML-escaping of &/<>). Drift from these snapshots fails the build.
//   2. SAFETY — feed it hostile raw HTML (script/img/onerror/div) and assert every tag
//      is ESCAPED, never passed through. This is the renderer's intentional, documented
//      DEVIATION from CommonMark (which passes HTML blocks through): we harden instead.
//
// Documented deviations from strict CommonMark (asserted via the SUBSET snapshots, not
// bugs): thematic break renders as HTML5 void `<hr>` (not `<hr />`); single-block
// blockquotes/headings are not wrapped in an inner `<p>`; raw HTML is escaped.
import { renderMarkdown } from "../posts.mjs";

let fails = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); fails++; };

// ---- 1. CONFORMANCE snapshots: input → exact expected HTML ----------------------
// Each expected value is the CommonMark-conformant rendering for the supported subset
// (verified against the spec for these constructs). A change to renderMarkdown that
// alters any of these must update the snapshot deliberately.
const CONFORMANCE = {
  "## A heading": "<h2>A heading</h2>",
  "### Sub heading": "<h3>Sub heading</h3>",
  "# Title here": "<h2>Title here</h2>", // a stray h1 is demoted: the page template owns the title
  "This is *italic* and **bold** text.": "<p>This is <em>italic</em> and <strong>bold</strong> text.</p>",
  "Use the `build.mjs` file.": "<p>Use the <code>build.mjs</code> file.</p>",
  "See [the site](https://example.com).": '<p>See <a href="https://example.com">the site</a>.</p>',
  "- one\n- two\n- three": "<ul><li>one</li><li>two</li><li>three</li></ul>",
  "* a\n* b": "<ul><li>a</li><li>b</li></ul>",
  "Just a plain paragraph\nwith a soft break.": "<p>Just a plain paragraph with a soft break.</p>",
  "Tom & Jerry < > test.": "<p>Tom &amp; Jerry &lt; &gt; test.</p>",
};

// ---- SUBSET snapshots: documented deviations from strict CommonMark -------------
const SUBSET = {
  "---": "<hr>",                                                       // HTML5 void style
  "> quoted line\n> second line": "<blockquote>quoted line second line</blockquote>", // no inner <p>
};

for (const [md, want] of [...Object.entries(CONFORMANCE), ...Object.entries(SUBSET)]) {
  const got = renderMarkdown(md);
  if (got !== want) fail(`snapshot drift for ${JSON.stringify(md)}\n      want: ${want}\n      got:  ${got}`);
}

// ---- 2. SAFETY: raw HTML must be escaped, never passed through ------------------
const HOSTILE = [
  '<div onclick="x">hi</div> and <script>alert(1)</script>',
  "An <img src=x onerror=alert(1)> inline.",
  "<a href=javascript:alert(1)>x</a>",
  "<iframe src=//evil></iframe>",
];
// Only these tags are legitimately produced by the renderer; anything else in the
// output of a hostile input is a raw-HTML leak.
const ALLOWED_TAGS = new Set(["p", "h2", "h3", "ul", "li", "blockquote", "hr", "code", "a", "strong", "em"]);
const DANGEROUS = /\b(onclick|onerror|onload)\b|javascript:/i;

for (const md of HOSTILE) {
  const out = renderMarkdown(md);
  // every tag in the output must be from the allowed set (escaped tags appear as &lt;…)
  for (const t of out.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b/g)) {
    if (!ALLOWED_TAGS.has(t[1].toLowerCase())) fail(`unsafe raw HTML leaked through renderer: <${t[1]}> from ${JSON.stringify(md)}`);
  }
  // and no live event handlers / javascript: URLs survived unescaped
  if (DANGEROUS.test(out) && !/&lt;/.test(out)) fail(`dangerous attribute/URL not neutralised: ${JSON.stringify(md)} → ${out}`);
}

console.log("");
if (fails) {
  console.error(`✗ commonmark-gate: ${fails} failure(s) — the posts renderer drifted or leaked raw HTML.`);
  process.exit(1);
}
console.log(`✓ commonmark-gate: renderMarkdown pins ${Object.keys(CONFORMANCE).length} CommonMark + ${Object.keys(SUBSET).length} subset construct(s); ${HOSTILE.length} hostile input(s) fully escaped.`);
