#!/usr/bin/env node
// Readability SIGNAL gate — a zero-dep readability report over the site's curated copy.
//
//   node scripts/readability-gate.mjs            # report (WARN-only, exit 0)
//   node scripts/readability-gate.mjs --strict   # escalate every WARN to an error (exit 1)
//
// HONEST FRAMING (read docs/readability-gate.md): this is a READABILITY SIGNAL, not a
// "cognitive-load score". Flesch-Kincaid / Gunning Fog estimate a US reading grade from
// surface features (sentence length, syllables-per-word). They do NOT measure how hard an
// idea is to think about. The copy here is hand-curated and signed off (string-audit), so
// the gate is WARN-by-default: it reports the signal and flags long sentences, long
// paragraphs, passive voice, and unexplained acronyms — but it only fails the build on
// EGREGIOUS thresholds (a runaway sentence or an absurd grade), or when run with --strict.
//
// Thresholds (documented, deliberately generous for terse technical marketing copy):
//   reading grade   WARN > 14 (college) · EGREGIOUS (block) > 22
//   sentence length WARN > 30 words      · EGREGIOUS (block) > 60 words
//   paragraph length WARN > 90 words
//   passive voice / unexplained acronym  WARN (per occurrence)
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const strict = process.argv.includes("--strict");
const j = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// Thresholds.
const T = { gradeWarn: 14, gradeBlock: 22, sentWarn: 30, sentBlock: 60, paraWarn: 90 };

// Acronyms that are common/explained enough not to warn (domain vocabulary of this site).
const KNOWN_ACRONYMS = new Set([
  "AI", "CLI", "PR", "PRS", "CI", "AWS", "DOM", "HTML", "CSS", "JSON", "RDF", "URL", "RSS",
  "SLSA", "PDF", "BA", "NY", "US", "OCI", "GHCR", "OIDC", "API", "SBOM", "CID", "IPFS",
  "SPDX", "DNS", "MCP", "VC", "TS", "L2L", "AR", "SHA", "TDD", "SHACL", "RFC", "SEO",
  "NYC", "ID",
]);

// ---- text utilities (zero-dep) --------------------------------------------------
const stripMarkup = (s) =>
  String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&middot;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const words = (s) => (s.match(/[A-Za-z][A-Za-z'’-]*/g) || []);
const sentences = (s) => s.split(/(?<=[.!?])\s+(?=[A-Z(])/).map((x) => x.trim()).filter(Boolean);

// Vowel-group syllable estimate, with silent trailing-e correction; min 1.
const syllables = (w) => {
  w = w.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  let groups = (w.match(/[aeiouy]+/g) || []).length;
  if (/e$/.test(w) && !/[aeiouy]e$/.test(w) && groups > 1) groups--; // silent final e
  return Math.max(1, groups);
};

const complex = (w) => syllables(w) >= 3; // Gunning Fog "complex word"

// ---- collect the curated prose corpus -------------------------------------------
// Atoms/prose with sentence structure. Short labels (nav, eyebrows) are excluded — a
// reading-grade formula is meaningless on a two-word button.
const corpus = []; // { id, text }
const add = (id, text) => {
  const t = stripMarkup(text);
  if (t && words(t).length >= 6) corpus.push({ id, text: t });
};

const profile = await j("data/profile.json");
add("profile.basics.headline", profile.basics?.headline);
add("profile.basics.summary", profile.basics?.summary);
for (const [i, w] of (profile.work || []).entries()) {
  add(`profile.work[${i}].summary (${w.name})`, w.summary);
  for (const [k, h] of (w.highlights || []).entries()) add(`profile.work[${i}].highlights[${k}] (${w.name})`, h);
}
for (const [i, p] of (profile.projects || []).entries()) add(`profile.projects[${i}].description (${p.name})`, p.description);

const pres = await j("data/presentation.json");
add("presentation.intro", pres.intro);
add("presentation.banner.tagline", pres.banner?.tagline);
add("presentation.seeking.focus", pres.seeking?.focus);
add("presentation.seeking.detail", pres.seeking?.detail);

const copy = await j("data/copy.json");
for (const [id, v] of Object.entries(copy)) {
  if (id.startsWith("_") || typeof v !== "string") continue;
  add(`copy.${id}`, v); // add() filters to >= 6 words, so only the ledes/prose qualify
}

// ---- score ----------------------------------------------------------------------
let warns = 0, blocks = 0;
const warn = (m) => { console.log(`  ⚠ ${m}`); warns++; };
const block = (m) => { console.error(`  ✗ ${m}`); blocks++; };

const PASSIVE = /\b(?:is|are|was|were|be|been|being|am)\b\s+(?:[a-z]+ly\s+)?(?:[a-z]+ed|written|built|made|done|shown|given|held|kept|driven|known|seen|taken|drawn|met|run|set|read|put|sent|brought|caught)\b/gi;

let totW = 0, totS = 0, totSyl = 0, totComplex = 0;
for (const { id, text } of corpus) {
  const ws = words(text);
  const ss = sentences(text);
  const syl = ws.reduce((a, w) => a + syllables(w), 0);
  const cx = ws.filter(complex).length;
  totW += ws.length; totS += ss.length; totSyl += syl; totComplex += cx;

  // long sentences
  for (const s of ss) {
    const n = words(s).length;
    if (n > T.sentBlock) block(`${id}: sentence of ${n} words exceeds egregious cap (${T.sentBlock}) — "${s.slice(0, 70)}…"`);
    else if (n > T.sentWarn) warn(`${id}: long sentence (${n} words) — "${s.slice(0, 70)}…"`);
  }
  // long paragraph (the atom as a whole)
  if (ws.length > T.paraWarn) warn(`${id}: long paragraph (${ws.length} words)`);
  // passive voice
  for (const m of text.match(PASSIVE) || []) warn(`${id}: possible passive voice — "${m.trim()}"`);
  // unexplained acronyms (all-caps token not in the known set and not expanded in-text)
  for (const tok of text.match(/\b[A-Z][A-Z0-9]{1,6}s?\b/g) || []) {
    const base = tok.replace(/s$/, "").toUpperCase();
    if (!KNOWN_ACRONYMS.has(tok.toUpperCase()) && !KNOWN_ACRONYMS.has(base)) warn(`${id}: unexplained acronym "${tok}"`);
  }
}

// aggregate reading grade
const fk = 0.39 * (totW / totS) + 11.8 * (totSyl / totW) - 15.59;
const fog = 0.4 * ((totW / totS) + 100 * (totComplex / totW));
const grade = (fk + fog) / 2;
const g = (x) => x.toFixed(1);

console.log("");
console.log(`readability signal (curated copy — ${corpus.length} prose atoms, ${totW} words, ${totS} sentences):`);
console.log(`  Flesch-Kincaid grade ${g(fk)} · Gunning Fog ${g(fog)} · mean ${g(grade)}`);
console.log(`  (a US reading-grade SIGNAL from sentence length + syllables — NOT a cognitive-load score; see docs/readability-gate.md)`);
console.log("");

if (grade > T.gradeBlock) block(`mean reading grade ${g(grade)} exceeds egregious cap (${T.gradeBlock})`);
else if (grade > T.gradeWarn) warn(`mean reading grade ${g(grade)} above college level (${T.gradeWarn})`);

console.log("");
if (blocks) {
  console.error(`✗ readability-gate: ${blocks} egregious finding(s), ${warns} warning(s).`);
  process.exit(1);
}
if (strict && warns) {
  console.error(`✗ readability-gate (--strict): ${warns} warning(s) escalated to errors.`);
  process.exit(1);
}
console.log(`✓ readability-gate: signal reported — ${warns} warning(s), 0 egregious. (WARN-only; pass --strict to block on warnings.)`);
