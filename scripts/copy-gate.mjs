#!/usr/bin/env node
// atomic-copy enforcement gate (see docs/atomic-copy.md).
//
// The invariant: no user-facing string is embedded directly in the site — every
// visible word traces to a copy atom. There are two atom sources:
//   1. data/copy.json     — the static UI chrome (eyebrows, headings, labels, …),
//                           resolved in build.mjs via copy(id);
//   2. the content contracts — data/profile.json (identity/résumé copy),
//                           data/presentation.json (render-context slugs),
//                           data/site.json (the GitHub corpus), data/highlight-copy.json,
//                           and the brand content strings (org/tagline/thesis/desc).
// Together these are THE copy atoms. This gate renders nothing — it reads the already
// built dist/ HTML, extracts the visible body text, and asserts every visible word is
// covered by an atom. An uncovered word means a human-readable string was typed inline
// in a template instead of sourced from an atom — the build fails (under --strict).
//
//   node scripts/copy-gate.mjs            # report-only (exit 0)
//   node scripts/copy-gate.mjs --strict   # gate: exit 1 on any uncovered word
//
// SCOPE (explicit — no silent partial coverage):
//   MIGRATED / ENFORCED : the homepage (/) and the résumé (/resume). Every visible
//                         word on these two pages must trace to an atom.
//   DEFERRED            : (a) other routes — /provenance, /blog, blog posts, 404 — are
//                         not yet scanned (their chrome is not migrated); (b) <head>
//                         content (titles, meta descriptions, og/twitter) on all pages;
//                         (c) format-derived text — month abbreviations + "present" from
//                         fmtRange, the generated ISO date, numeric figures/counts, and
//                         the anti-scrape email obfuscation markers "[at]"/"[dot]" — all
//                         derive deterministically from data, not free copy (see FORMAT_VOCAB).
//   LIMITATION         : coverage is word-level, not segment-level — a newly inlined
//                         phrase whose every word already appears in some atom would not
//                         be caught. The gate catches genuinely-new vocabulary, which is
//                         what inlining copy introduces in practice.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const j = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// Pages this gate enforces. dist/ must already be built (npm run build).
const SCOPE = ["index.html", "resume.html"];

// ---- visible-text extraction --------------------------------------------------
// Drop <head> (deferred), <script>/<style> (not copy), then strip tags → text nodes.
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
  const strings = await j("brand/content/strings.json");
  for (const v of Object.values(strings)) if (v && typeof v === "object" && "$value" in v) atomStrings.push(v.$value);
} catch { /* brand submodule optional */ }

// Format vocabulary — deterministic, data-derived renderings, not free copy (see DEFERRED).
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FORMAT_VOCAB = new Set([...MONTHS, "present", "at", "dot"]); // "[at]"/"[dot]" = email obfuscation
const isFormatToken = (t) =>
  /^[\p{N}]+$/u.test(t) ||              // bare numbers (figures, counts)
  /^\d{4}(-\d{2}){0,2}$/.test(t) ||     // ISO date / date fragment
  FORMAT_VOCAB.has(t);

const corpus = new Set();
for (const s of atomStrings) for (const t of tokenize(s)) corpus.add(t);

// ---- scan ---------------------------------------------------------------------
let uncovered = 0;
for (const file of SCOPE) {
  let html;
  try { html = await readFile(join(root, "dist", file), "utf8"); }
  catch { console.error(`✗ copy-gate: dist/${file} not found — run \`npm run build\` first.`); process.exit(2); }

  const hits = new Map(); // token → first raw spelling
  for (const raw of visibleText(html).match(TOKEN) || []) {
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
console.log(`✓ atomic-copy gate: homepage + résumé are fully atomized (${corpus.size} atom words in corpus).`);
