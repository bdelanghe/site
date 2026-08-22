#!/usr/bin/env node
// reader-structure gate — once a reader mode HAS the text, can you read it?
//
// The companion to reader-view-gate.mjs, and deliberately a separate measurement,
// because the two fail independently and one was green through the other's outage:
//
//   reader-view       COVERAGE — how much of the page's text Readability extracts,
//                     and whether the browser offers the Reader control at all.
//   this gate         STRUCTURE — whether the text it extracted still has the line
//                     breaks and separators a reader needs to parse it.
//
// WHY THIS EXISTS. /'s Background and Education entries were built entirely from
// <span>s: a grid put the date in the margin column and `.entry__what { display:
// block }` broke the summary onto its own line. Reader renders the DOM with the
// CLASSES STRIPPED and its own stylesheet applied, so both of those bought nothing
// there, and seven employment records collapsed into run-on lines:
//
//   "Aug 2026 – presentEmpathic · Founding EngineerInfrastructure for operating…"
//
// reader-view was green throughout, correctly: every word WAS extracted. Coverage
// was ~100% and the page was still a wall. Across the site there were 173 of these.
//
// WHAT IT MEASURES. Run each page through Readability, then look at the markup
// Reader would render — after class-stripping, so only an element's DEFAULT display
// survives. Any two adjacent INLINE siblings that both bear text and have no
// whitespace at the join are reported: their text renders as one word.
//
// That is decidable and high-signal. Two inline elements MEANT to sit on one line
// are written with a separator between them ("A · B"), which this passes. Two with
// nothing between them are either a missing separator or, more often, two things
// that wanted to be blocks — and the fix is to put the structure in the markup,
// where Reader can still see it, rather than in a class it throws away.
//
//   node scripts/reader-structure-gate.mjs dist
//
// Reads the built HTML, writes nothing.
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const dir = process.argv[2] ?? "dist";

// Elements that are inline by default, so nothing but adjacent text separates them
// once the page's own CSS is gone.
const INLINE = new Set([
  "a", "abbr", "b", "cite", "code", "data", "em", "i", "kbd", "label", "mark",
  "output", "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time",
  "u", "var",
]);

async function pages(root, sub = "") {
  const out = [];
  for (const e of await readdir(join(root, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await pages(root, rel)));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

let total = 0, checked = 0;
const report = [];

for (const rel of (await pages(dir)).sort()) {
  const html = await readFile(join(dir, rel), "utf8");
  const dom = new JSDOM(html, { url: "https://robertdelanghe.dev/" });
  const parsed = new Readability(dom.window.document.cloneNode(true)).parse();
  // Not readerable is reader-view-gate's business, not this gate's — it reports the
  // pages that have no article to extract, and says so there.
  if (!parsed?.content) continue;
  checked++;

  const doc = new JSDOM(`<body>${parsed.content}</body>`).window.document;
  const joins = [];
  for (const el of doc.querySelectorAll("*")) {
    const kids = [...el.childNodes];
    for (let i = 0; i < kids.length - 1; i++) {
      const a = kids[i], b = kids[i + 1];
      if (a.nodeType !== 1 || b.nodeType !== 1) continue;      // a text node between them IS the separator
      if (!INLINE.has(a.tagName.toLowerCase())) continue;
      if (!INLINE.has(b.tagName.toLowerCase())) continue;
      const left = (a.textContent ?? "").trim(), right = (b.textContent ?? "").trim();
      if (!left || !right) continue;                            // purely visual (a bar fill) — nothing to run together
      joins.push(`${left.slice(-30)}⧗${right.slice(0, 30)}`);
    }
  }
  total += joins.length;
  const route = "/" + rel.replace(/\.html$/, "").replace(/^index$/, "");
  if (joins.length) report.push([route, joins]);
  else console.log(`  ✓ ${route.padEnd(38)} no run-together joins`);
}

for (const [route, joins] of report) {
  console.error(`\n  ✗ ${route} — ${joins.length} join(s) render as one word:`);
  for (const j of joins.slice(0, 10)) console.error(`      …${j}…`);
  if (joins.length > 10) console.error(`      (+${joins.length - 10} more)`);
}

if (total) {
  console.error(
    `\n✗ reader-structure-gate: ${total} run-together join(s) across ${report.length} page(s).\n` +
      "\n  Reader strips class attributes, so a line break that came from a grid, a flex\n" +
      "  row, or `display: block` on a class does not exist there. Put the structure in\n" +
      "  the markup instead: block elements (<p>, <div>) where a line break is meant, or\n" +
      "  real whitespace between inline items — flex and grid discard it visually, so it\n" +
      "  costs nothing on screen and is the whole difference in Reader.",
  );
  process.exit(1);
}
console.log(
  `\n✓ reader-structure-gate: ${checked} readerable page(s) — every extracted element keeps its separation without CSS.`,
);
