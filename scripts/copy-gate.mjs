#!/usr/bin/env node
// atomic-copy enforcement gate (see docs/atomic-copy.md).
//
// The invariant: no user-facing string is embedded directly in the site — every
// visible word traces to a copy atom. There are two atom sources:
//   1. data/copy.json     — the static UI chrome (eyebrows, headings, labels,
//                           nav/link text, the provenance chain step names, the
//                           <head> titles/descriptions, llms.txt headers, …),
//                           resolved in build.mjs via copy(id);
//   2. the content contracts — data/profile.json (identity/résumé copy),
//                           data/presentation.json (render-context slugs),
//                           data/site.json (the GitHub corpus), data/highlight-copy.json,
//                           the brand content strings (org/tagline/thesis/desc), and
//                           posts/*.md frontmatter (post title/description/tags — sourced
//                           copy validated against contract/posts.schema.json).
// Together these are THE copy atoms. This gate renders nothing — it reads the already
// built dist/ HTML, extracts the visible body text plus the <head> page title/description,
// and asserts every visible word is covered by an atom. An uncovered word means a
// human-readable string was typed inline in a template instead of sourced from an atom —
// the build fails (under --strict).
//
//   node scripts/copy-gate.mjs            # report-only (exit 0)
//   node scripts/copy-gate.mjs --strict   # gate: exit 1 on any uncovered word
//
// SCOPE (explicit — no silent partial coverage):
//   MIGRATED / ENFORCED : the homepage (/), the résumé (/resume), /provenance, /blog
//                         (index) and every blog post (/blog/<slug>). For each, both the
//                         visible body text AND the <head> page title + meta description
//                         (incl. the og/twitter title/description/image:alt mirrors) must
//                         trace to an atom.
//   REGION-EXEMPT       : two rendered regions are excluded from the body scan because
//                         their text is not free chrome (documented, not silent):
//                         (a) the /provenance <ol class="prov-chain"> — its step BODIES
//                             are long-form provenance narrative interleaved with
//                             build-computed digests/SHAs, links, and the @@COMMIT@@/@@DATE@@
//                             deploy stamps, so it cannot be a set of static atoms; the
//                             step NAMES + the seal title ARE atoms (prov.step.*,
//                             prov.seal.title), enforced by copy()'s throw-on-unknown, not
//                             by this scan;
//                         (b) each post's <div class="post__body e-content"> — the article
//                             body is prose rendered from the post's markdown (its own
//                             source/contract), not UI chrome.
//   DEFERRED            : (a) llms.txt — NOT scanned: its body is data-derived link
//                             labels + repo/post descriptions and, crucially, raw URLs and
//                             post slugs (e.g. /blog/<slug>) that are not copy and would
//                             false-positive; its section headers ("Links", "Selected
//                             work", "Writing") ARE atoms (llms.links/llms.work/nav.writing),
//                             enforced by copy(). (b) <head> <link rel="alternate"> title
//                             attributes — the feed title "Robert DeLanghe — Writing" (in
//                             head(), every page) and the "JSON Résumé (machine-readable)"
//                             alternate label — are alternate-resource metadata, not the
//                             page title/description, so not scanned and not migrated.
//                             (c) the homepage footer literal "Robert DeLanghe · Bounded
//                             Systems" (still inline; word-covered by name + brand org).
//                             (d) format-derived / build-provenance text — month
//                             abbreviations + "present" from fmtRange, the generated ISO
//                             date, numeric figures/counts, the short git commit SHA in the
//                             footer/provenance link (COMMIT.slice(0,7), only set in CI), and
//                             the anti-scrape email markers "[at]"/"[dot]" — all derive
//                             deterministically from data/the build (see FORMAT_VOCAB).
//   LIMITATION         : coverage is word-level, not segment-level — a newly inlined
//                         phrase whose every word already appears in some atom would not
//                         be caught (e.g. the deferred inline footer literal above). The
//                         gate catches genuinely-new vocabulary, which is what inlining
//                         copy introduces in practice.
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const j = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// Pages this gate enforces. dist/ must already be built (npm run build). Blog post
// pages are discovered so a new post is covered without editing this list.
const SCOPE = ["index.html", "resume.html", "provenance.html", "blog.html", "colophon.html"];
try {
  for (const f of (await readdir(join(root, "dist", "blog"))).filter((f) => f.endsWith(".html"))) SCOPE.push(`blog/${f}`);
} catch { /* no posts yet */ }

// ---- visible-text extraction --------------------------------------------------
// Drop <head> (scanned separately via headCopy), <script>/<style> (not copy), then
// strip tags → text nodes.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", rarr: "→", larr: "←", darr: "↓", uarr: "↑", eacute: "é", mdash: "—", ndash: "–" };
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e] ?? m;
});
const visibleText = (html) =>
  decode(html
    .replace(/<head[\s\S]*?<\/head>/i, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "));

// Per-route region exemptions (see SCOPE → REGION-EXEMPT). Applied to the raw HTML
// before visibleText; the chain <ol> is the only ordered list (greedy is safe), and a
// rendered post body never contains a <div> (markdown emits no <div>) so the first
// </div> closes it.
const stripExemptRegions = (file, html) => {
  if (file === "provenance.html") html = html.replace(/<ol class="prov-chain">[\s\S]*<\/ol>/i, " ");
  if (file.startsWith("blog/")) html = html.replace(/<div class="post__body e-content">[\s\S]*?<\/div>/i, " ");
  return html;
};

// ---- <head> page title + description (the scanned meta copy) -------------------
// Scan the human-facing page title + description, including the og/twitter mirrors
// (same words). Structural meta (charset, viewport, theme-color, og:type/url/image*
// dimensions, the image URL) and <link> title attrs are NOT copy — excluded.
const COPY_META = new Set(["description", "og:title", "og:description", "og:image:alt", "twitter:title", "twitter:description", "twitter:image:alt"]);
const headCopy = (html) => {
  const m = html.match(/<head[\s\S]*?<\/head>/i);
  if (!m) return "";
  const head = m[0];
  const out = [];
  const t = head.match(/<title>([\s\S]*?)<\/title>/i);
  if (t) out.push(t[1]);
  for (const mm of head.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?>/gi))
    if (COPY_META.has(mm[1])) out.push(mm[2]);
  return decode(out.join("  "));
};

// ---- tokenization -------------------------------------------------------------
// A token is a letter/number run (internal apostrophes/hyphens kept): "in-toto",
// "self-labeling", "a11y", "2026-06-21". Normalize: lowercase, ASCII-fold apostrophe.
const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’]*(?:-[\p{L}\p{N}'’]+)*/gu;
const norm = (t) => t.toLowerCase().replace(/[’]/g, "'");
const tokenize = (s) => (String(s).match(TOKEN) || []).map(norm);

// ---- the atom corpus ----------------------------------------------------------
const stringLeaves = (o, acc = []) => {
  if (o == null) return acc;
  if (typeof o === "string") acc.push(o);
  else if (Array.isArray(o)) o.forEach((x) => stringLeaves(x, acc));
  else if (typeof o === "object") Object.values(o).forEach((x) => stringLeaves(x, acc));
  return acc;
};

const atomStrings = [];
for (const f of ["data/copy.json", "data/profile.json", "data/presentation.json", "data/site.json", "data/highlight-copy.json"]) {
  try { atomStrings.push(...stringLeaves(await j(f))); } catch { /* optional */ }
}
// brand content strings are {$value, $description} — only the $value is shipped copy.
try {
  const strings = await j("node_modules/@bdelanghe/brand/content/strings.json");
  for (const v of Object.values(strings)) if (v && typeof v === "object" && "$value" in v) atomStrings.push(v.$value);
} catch { /* @bdelanghe/brand optional (not yet installed) */ }
// post frontmatter — sourced copy (contract/posts.schema.json): title/description render
// on /blog + the post <head>/<h1>; tags render as chips. (Body prose is region-exempt.)
try {
  const dir = join(root, "posts");
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".md"))) {
    const fm = /^---\n([\s\S]*?)\n---/.exec(await readFile(join(dir, f), "utf8"));
    if (!fm) continue;
    for (const line of fm[1].split("\n")) {
      const mm = /^(title|description|tags):\s*(.*)$/.exec(line);
      if (mm) atomStrings.push(mm[2]);
    }
  }
} catch { /* no posts */ }

// Format vocabulary — deterministic, data-derived renderings, not free copy (see DEFERRED).
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FORMAT_VOCAB = new Set([...MONTHS, "present", "at", "dot"]); // "[at]"/"[dot]" = email obfuscation
const isFormatToken = (t) =>
  /^[\p{N}]+$/u.test(t) ||              // bare numbers (figures, counts)
  /^\d{4}(-\d{2}){0,2}$/.test(t) ||     // ISO date / date fragment
  /^[0-9a-f]{7,40}$/.test(t) ||         // git commit SHA — footer/provenance link renders COMMIT.slice(0,7) in CI
  FORMAT_VOCAB.has(t);

const corpus = new Set();
for (const s of atomStrings) for (const t of tokenize(s)) corpus.add(t);

// ---- scan ---------------------------------------------------------------------
let uncovered = 0;
for (const file of SCOPE) {
  let html;
  try { html = await readFile(join(root, "dist", file), "utf8"); }
  catch { console.error(`✗ copy-gate: dist/${file} not found — run \`npm run build\` first.`); process.exit(2); }

  const scanText = headCopy(html) + "  " + visibleText(stripExemptRegions(file, html));
  const hits = new Map(); // token → first raw spelling
  for (const raw of scanText.match(TOKEN) || []) {
    const t = norm(raw);
    if (isFormatToken(t) || corpus.has(t)) continue;
    if (!hits.has(t)) hits.set(t, raw);
  }
  if (hits.size) {
    uncovered += hits.size;
    console.error(`✗ ${file}: ${hits.size} visible word(s) not traceable to a copy atom:`);
    for (const [t, raw] of hits) console.error(`    "${raw}"  — add it to data/copy.json (or source it from a contract)`);
  } else {
    console.log(`✓ ${file}: every visible word traces to a copy atom`);
  }
}

if (uncovered) {
  console.error(`\natomic-copy gate: ${uncovered} inline string(s) found. Each visible word must be a copy atom (data/copy.json) or sourced from a content contract.`);
  process.exit(strict ? 1 : 0);
}
console.log(`✓ atomic-copy gate: ${SCOPE.length} routes fully atomized (${corpus.size} atom words in corpus).`);
