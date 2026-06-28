#!/usr/bin/env node
// Site config shim → the vendored, hash-pinned conformance-kit readability gate
// (vendor/conformance-kit/gates/readability-gate.mjs). The kit gate scores a CORPUS
// of prose (an input); THIS site assembles that corpus from its own contracts
// (data/profile.json + data/presentation.json + data/copy.json) — which fields count
// as prose, their ids, and the ≥6-word floor are site decisions — then delegates the
// scoring (Flesch-Kincaid / Gunning Fog, long-sentence / passive / acronym flags).
//
//   node scripts/readability-gate.mjs            # report (WARN-only, exit 0)
//   node scripts/readability-gate.mjs --strict   # escalate every WARN to an error (exit 1)
//
// HONEST FRAMING (docs/readability-gate.md): a READABILITY SIGNAL, not a
// "cognitive-load score". WARN-by-default; --strict blocks on warnings.
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const j = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// strip markup so a reading-grade formula sees prose, not tags/entities (mirrors the
// kit's own normalisation; pre-applying it here keeps the assembled ids stable).
const stripMarkup = (s) =>
  String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&middot;|&nbsp;/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
const wordCount = (s) => (s.match(/[A-Za-z][A-Za-z'’-]*/g) || []).length;

// ---- assemble the curated prose corpus (the site-specific input) ----------------
// Atoms/prose with sentence structure. Short labels (nav, eyebrows) are excluded — a
// reading-grade formula is meaningless on a two-word button (the ≥6-word floor).
const corpus = []; // { id, text }
const add = (id, text) => {
  const t = stripMarkup(text);
  if (t && wordCount(t) >= 6) corpus.push({ id, text: t });
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
  add(`copy.${id}`, v); // add() filters to ≥ 6 words, so only the ledes/prose qualify
}

// ---- hand the corpus to the kit gate --------------------------------------------
const corpusPath = join(tmpdir(), `readability-corpus-${process.pid}.json`);
await writeFile(corpusPath, JSON.stringify(corpus));

const gate = join(root, "vendor", "conformance-kit", "gates", "readability-gate.mjs");
const args = [gate, corpusPath, ...process.argv.slice(2)];
const res = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    // this site's domain acronyms beyond the kit's defaults (so they don't warn).
    READABILITY_KNOWN_ACRONYMS: "BA,NY,L2L,AR,NYC",
  },
});
process.exit(res.status ?? 1);
