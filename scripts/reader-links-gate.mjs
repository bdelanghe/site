#!/usr/bin/env node
// reader-links gate — do the links survive?
//
// The third leg of the Reader contract, and the one a real reader noticed first:
//
//   reader-view        COVERAGE  — how much text Readability extracts, and whether
//                                  the browser offers the Reader control at all.
//   reader-structure   LEGIBILITY— whether the extracted text keeps its separation
//                                  once Reader strips the class attributes.
//   this gate          LINKS     — whether the links inside that text are still there.
//
// They fail independently, which is the whole reason there are three. /resume was
// the proof: 94% coverage, clean structure, and SEVEN OF FOURTEEN LINKS GONE —
// Empathic, Pioneer Works, Kaleida, Recurse Center, Scope of Work, Bounded Systems,
// Bennington College. Every employer and institution, silently, with both other
// gates green.
//
// WHY IT HAPPENS. Readability's _cleanConditionally culls blocks whose link density
// is high relative to their text, and <div> is on its tag list while <section> and
// <p> are not. A résumé entry is short and mostly link, so each one was being thrown
// away whole. Rebuilding those entries as <section>/<p> — which is also what they
// are — took /resume to 14/14 and /interests from 123 to 206 surviving links.
//
// WHAT IS EXEMPT, and why it is a named list rather than a rule. The obvious rule —
// "in-page #fragment links are controls" — does not hold here: the language rows on
// /archive point at GitHub search URLs and still are not prose. So the exemption is
// by ROLE, written down, and anything not on this list must survive:
const CONTROLS = new Set([
  "chip", "chip--all",  // topic filter chips
  "tag",                // topic tags on a project card
  "bar__k",             // a language bar's row — a browse-elsewhere affordance
  "fig",                // the figure links above them
]);
const CHROME = new Set([
  "p-author", "h-card", // the byline; the name is in the document anyway
]);
// Pages that ARE a list of links — Reader is structurally the wrong surface for them
// and their guarantee is the lossless Markdown twin, checked by md-parity-gate. Same
// exemption reader-view-gate makes, for the same reason, named here too so a page
// cannot be quietly added to it.
const NAV_ONLY = new Set(["blog.html", "colophon.html", "404.html"]);

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const dir = process.argv[2] ?? "dist";

async function htmlFiles(root, sub = "") {
  const out = [];
  for (const e of await readdir(join(root, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await htmlFiles(root, rel)));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

const exempt = (a) => {
  for (const c of a.classList ?? []) if (CONTROLS.has(c) || CHROME.has(c)) return true;
  // a back-link sitting in a label eyebrow is navigation, not content
  const p = a.parentElement;
  return !!p && [...(p.classList ?? [])].includes("eyebrow");
};

let failed = 0, pages = 0;
const rows = [];

for (const rel of (await htmlFiles(dir)).sort()) {
  const dom = new JSDOM(await readFile(join(dir, rel), "utf8"), { url: "https://robertdelanghe.dev/" });
  const doc = dom.window.document;
  for (const s of doc.querySelectorAll("script,style,noscript")) s.remove();
  const subject = doc.querySelector("article") ?? doc.body;
  const parsed = new Readability(doc.cloneNode(true)).parse();
  const out = new JSDOM(`<body>${parsed?.content ?? ""}</body>`).window.document;
  const kept = new Set([...out.querySelectorAll("a")].map((a) => (a.textContent ?? "").trim()));

  const content = [], lost = [];
  for (const a of subject.querySelectorAll("a")) {
    const text = (a.textContent ?? "").trim();
    if (!text || exempt(a)) continue;
    content.push(text);
    if (!kept.has(text)) lost.push(`${text.slice(0, 34)} → ${(a.getAttribute("href") ?? "").slice(0, 44)}`);
  }
  pages++;
  const route = "/" + rel.replace(/\.html$/, "").replace(/^index$/, "");
  const skip = NAV_ONLY.has(rel);
  if (skip) { rows.push([`  · ${route.padEnd(38)} link index — Reader exempt, /…md is the guarantee`]); continue; }
  if (lost.length) { failed++; rows.push([`  ✗ ${route.padEnd(38)} ${lost.length} of ${content.length} content link(s) dropped`, lost]); }
  else rows.push([`  ✓ ${route.padEnd(38)} all ${content.length} content link(s) survive`]);
}

for (const [line, lost] of rows) {
  (lost ? console.error : console.log)(line);
  for (const l of (lost ?? []).slice(0, 12)) console.error(`        ${l}`);
  if (lost && lost.length > 12) console.error(`        (+${lost.length - 12} more)`);
}

if (failed) {
  console.error(
    `\n✗ reader-links-gate: ${failed} page(s) lose content links in Reader.\n` +
      "\n  Readability culls blocks whose link density is high for their text, and <div>\n" +
      "  is on its cull list while <section> and <p> are not. A short, mostly-link block\n" +
      "  built from <div>s gets thrown away whole. Rebuild it from the elements it\n" +
      "  actually is — a <section> per record, a <p> per line — or give the block enough\n" +
      "  prose to stop reading as a link list.",
  );
  process.exit(1);
}
console.log(`\n✓ reader-links-gate: ${pages} page(s) — every content link survives Reader extraction.`);
