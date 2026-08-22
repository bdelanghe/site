#!/usr/bin/env node
// fold-load — cognitive load, measured as a fold.
//
//   node scripts/fold-load.mjs [distDir]            # report
//   node scripts/fold-load.mjs [distDir] --strict   # fail on a breach
//
// ── THE MODEL ────────────────────────────────────────────────────────────────
//
// Taken verbatim from the `unfold` vault's basis vocabulary, where a fold is
// "a transformation that preserves structure while reducing dimensionality"
// and an unfold is its inverse. A fold F over a set S is four things:
//
//   c: S → F                 compression mapping   (fold.md)
//   seed(F)                  extraction procedure  (fold.md)
//   u: seed → [e0, e1, ...]  generator rule, an anamorphism (generator-rule.md)
//   p(e)                     termination predicate (termination.md)
//
//   unfold(F, u) = u(seed(F))
//
// Two properties follow, and both are checkable:
//
//   FIDELITY   — a fold is honest when unfold(F, u) recovers S. Whatever c drops
//                is the RESIDUE: something the page asserts to a person that no
//                consumer of the record can recover. A lossy fold presented as a
//                complete record is a lie about the content, not a summary of it.
//
//   TRACTABILITY — termination is what keeps an unfold finite (termination.md),
//                and the cost of one expansion step is its FAN-OUT: how many
//                siblings the reader holds at once to choose among them. A node
//                whose fan-out exceeds the budget has no fold at all; it is the
//                raw set, presented.
//
// ── WHAT IS MEASURED ─────────────────────────────────────────────────────────
//
//   1. RECORD FOLD    data/profile.json → the emitted schema.org JSON-LD.
//                     S = the facts the page renders. F = the facts the record
//                     carries. Residue = S \ image(c), by value presence — a
//                     fact is recoverable when its value appears in the record.
//
//   2. RECORD SHAPE   each emitted JSON-LD tree: nodes, depth, widest sequence.
//                     Descriptive only. A fan-out budget is a WORKING-MEMORY
//                     budget and nobody holds a record in working memory — no
//                     person scans a <script type=ld+json>. Applying the budget
//                     here would be the same category error as counting a page's
//                     content links as competing controls, which is the thing
//                     that sent us looking for this model in the first place.
//
//   3. API FOLD       each document the static API serves. An MCP client's
//                     budget is its context window — bytes, measured, with no
//                     proxy in between — so a large document with no index that
//                     folds it hands the whole set to every caller. A document an
//                     index names WITH ITS COUNT is exempt: that is an informed
//                     unfold, one step of u taken on purpose.
//
//   4. PRESENTATION FOLD  each built page's choice tree, which is where the
//                     budget does belong. S = every choice on the page;
//                     seed(F) = its <summary> elements; F = the choices standing
//                     at rest; u = opening one <details>; p = a subtree with no
//                     further <details>. Each SIBLING RUN of choices at rest is
//                     one expansion step, and is held to the budget.
//
// ── THE BUDGET, AND WHY IT IS THIS NUMBER ────────────────────────────────────
//
// FAN_OUT_MAX is a working-memory budget, not a standard. It is the same shape
// of claim as focus-budget-gate's thresholds and carries the same caveat: it is
// a STATIC PROXY. It does not measure anyone's cognitive load, and no green run
// of this file is evidence that a person found the page usable. What it does
// measure is exact — how many like things a page puts in front of someone in one
// step, with no seed to fold them behind — and that is worth holding still.
const FAN_OUT_MAX = 9;   // Miller's 7±2, upper bound. A stated budget, not a finding.
// A run this small is a list, not a fold problem — flagging it would bury the
// real ones under navigation and footers.
const RUN_MIN = 4;
// The API budget, in bytes rather than in items, because that is the unit the
// consumer actually pays in. Roughly four thousand tokens of an agent's context
// for one tool call. A stated budget, like the one above, not a finding.
const DOC_BUDGET = 16 * 1024;
// A run is a CHOICE run only when the choices are what the container is made of.
// Twelve links inside a paragraph of prose are read in reading order, not scanned
// as competing options, and counting them as a twelve-wide choice is the exact
// modelling error this file was written to avoid — it is what makes a COGA
// density budget fire on an essay. Link density separates the two, and it is the
// same measure Readability already uses to decide what a block IS.
const CHOICE_DENSITY_MIN = 0.6;

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const dir = process.argv[2] ?? "dist";
const strict = process.argv.includes("--strict");

// ── walking JSON ─────────────────────────────────────────────────────────────

// Every leaf value in an object tree, as a path → value pair. Leaves are what a
// fold can drop; containers are what it reshapes.
function* leaves(node, path = "$") {
  if (Array.isArray(node)) {
    for (const [i, v] of node.entries()) yield* leaves(v, `${path}[${i}]`);
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) yield* leaves(v, `${path}.${k}`);
  } else if (node !== null && node !== undefined && String(node) !== "") {
    yield [path, String(node)];
  }
}

// nodes and depth. Both are counted over every child; only the fan-out test
// below distinguishes what kind of child it is.
function objectLoad(node, depth = 0) {
  const kids = Array.isArray(node)
    ? node
    : (node && typeof node === "object" ? Object.values(node) : []);
  let nodes = 1, maxDepth = depth;
  for (const k of kids) {
    const sub = objectLoad(k, depth + 1);
    nodes += sub.nodes;
    maxDepth = Math.max(maxDepth, sub.maxDepth);
  }
  return { nodes, maxDepth };
}

// The widest generated sequence in a record, named by the key that holds it.
//
// A fan-out is the output of a generator rule — `u: seed → [e0, e1, ...]`, an
// ordered sequence of like elements — so it is an ARRAY. A record's named
// properties are not a sequence: ten distinct keys are ten different questions,
// and you read the one you came for by name. Reported, not budgeted.
function widestRun(node, path = "$", best = ["$", 0]) {
  if (Array.isArray(node)) {
    if (node.length > best[1]) best = [path, node.length];
    node.forEach((v, i) => { best = widestRun(v, `${path}[${i}]`, best); });
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) best = widestRun(v, `${path}.${k}`, best);
  }
  return best;
}

// ── 1. RECORD FOLD ───────────────────────────────────────────────────────────

// A contract fact is recoverable from the record when its value appears there.
// Value presence, not path mapping: the question is whether a consumer of the
// JSON-LD can get the fact back at all, not whether it kept its shape.
function residue(source, record) {
  // One haystack, so containment counts: `sameAs: "https://github.com/bdelanghe"`
  // does carry both the network and the username, and a residue report that says
  // otherwise is noise. What it cannot fake is a fact the record never spells
  // out — a degree, a date, an employer.
  const carried = [...leaves(record)].map(([, v]) => v.trim().toLowerCase()).join("\u0000");
  const dropped = [];
  for (const [path, value] of leaves(source)) {
    const v = value.trim().toLowerCase();
    if (v.length < 2) continue;
    if (!carried.includes(v)) dropped.push([path, value]);
  }
  return dropped;
}

// Contract branches the page renders, so a drop here is a fact a reader can see
// and a machine cannot. Anything outside these is build metadata, not content.
const RENDERED = /^\$\.(basics|work|education|projects)\b/;
// Prose that is deliberately not in the record: long-form summaries and
// highlights are the page's job, and schema.org has nowhere honest to put them.
const PROSE = /\.(summary|highlights\[|description|_source|\$schema|version|canonical)/;

// ── 3. PRESENTATION FOLD ─────────────────────────────────────────────────────

// Every choice a reader can make on a page. A choice is a thing you can pick,
// which is what a fan-out is a fan-out OF — links, buttons, and the disclosure
// controls themselves.
const CHOICE = "a[href], button, summary, input, select, textarea";

// Where a node stands in the fold: 0 = at rest, n = n applications of u away.
//
// A <summary> is the SEED of its own <details>, not content inside it — a closed
// details still renders its summary, which is the whole point of a seed. So the
// details a summary labels does not fold it; every other closed details above it
// does. Counting the seed as folded made this file undercount every run that
// contains a disclosure, which is exactly the runs it exists to measure.
function foldParent(el) {
  const p = el.parentElement;
  return el.tagName === "SUMMARY" && p?.tagName === "DETAILS" ? p.parentElement : p;
}

function unfoldDepth(el, root) {
  let d = 0;
  for (let n = foldParent(el); n && n !== root; n = n.parentElement) {
    if (n.tagName === "DETAILS" && !n.hasAttribute("open")) d++;
  }
  return d;
}

// Which run a choice belongs to. A <details> is transparent here for the same
// reason: the seed is a peer of whatever stands beside it, not a run of one
// inside its own wrapper. `display: contents` on the wrapper makes that literal
// on screen, and the model says it regardless of the CSS.
function runParent(el) {
  return foldParent(el);
}

// What share of a container's text is inside its choices. 1.0 is a bare run of
// chips; a paragraph with a few links in it sits far below the threshold.
function linkDensity(el) {
  const total = (el.textContent ?? "").replace(/\s+/g, " ").trim().length;
  if (!total) return 0;
  let inside = 0;
  for (const c of el.querySelectorAll(CHOICE)) {
    inside += (c.textContent ?? "").replace(/\s+/g, " ").trim().length;
  }
  return inside / total;
}

// Name a container the way its author would recognise it — a run is only
// actionable if you can find it in the template.
function describe(el) {
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
  const id = el.getAttribute("id");
  return `<${el.tagName.toLowerCase()}${id ? "#" + id : cls ? "." + cls : ""}>`;
}

async function jsonFiles(root, sub = "") {
  const out = [];
  let entries;
  try { entries = await readdir(join(root, sub), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await jsonFiles(root, rel)));
    else if (e.name.endsWith(".json")) out.push(rel);
  }
  return out.sort();
}

async function htmlFiles(root, sub = "") {
  const out = [];
  for (const e of await readdir(join(root, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await htmlFiles(root, rel)));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

// ── run ──────────────────────────────────────────────────────────────────────

const fail = [];

// 1 ────────────────────────────────────────────────────────────────────────────
console.log("\nRECORD FOLD — data/profile.json → the emitted Person record\n");

const profile = JSON.parse(await readFile("data/profile.json", "utf8"));
const homeHtml = await readFile(join(dir, "index.html"), "utf8");
const personLd = JSON.parse(
  /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(homeHtml)[1],
);

const dropped = residue(profile, personLd)
  .filter(([p]) => RENDERED.test(p) && !PROSE.test(p));

const byBranch = new Map();
for (const [p, v] of dropped) {
  const branch = /^\$\.([a-z]+)/.exec(p)[1];
  if (!byBranch.has(branch)) byBranch.set(branch, []);
  byBranch.get(branch).push([p, v]);
}

const carriedCount = [...leaves(personLd)].length;
console.log(`  the record carries ${carriedCount} facts; the contract renders ${
  [...leaves(profile)].filter(([p]) => RENDERED.test(p) && !PROSE.test(p)).length
}\n`);
for (const [branch, items] of [...byBranch].sort()) {
  console.log(`  ✗ ${("$." + branch).padEnd(14)} ${items.length} fact(s) rendered, not recoverable`);
  for (const [p, v] of items.slice(0, 6)) {
    console.log(`        ${p.padEnd(30)} ${v.slice(0, 44)}`);
  }
  if (items.length > 6) console.log(`        (+${items.length - 6} more)`);
}
if (!byBranch.size) console.log("  ✓ every rendered fact is recoverable from the record");
else fail.push(`${dropped.length} rendered fact(s) the record drops`);

// 2 ────────────────────────────────────────────────────────────────────────────
console.log("\nRECORD SHAPE — each emitted JSON-LD tree (descriptive; no budget)\n");

for (const rel of (await htmlFiles(dir)).sort()) {
  const src = await readFile(join(dir, rel), "utf8");
  const m = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(src);
  if (!m) continue;
  const ld = JSON.parse(m[1]);
  const { nodes, maxDepth } = objectLoad(ld);
  const [widePath, wideN] = widestRun(ld);
  const route = "/" + rel.replace(/\.html$/, "").replace(/^index$/, "");
  console.log(
    `  · ${route.padEnd(40)} ${String(nodes).padStart(3)} nodes  depth ${maxDepth}` +
    (wideN ? `  widest ${widePath} ×${wideN}` : ""),
  );
}

// 3 ────────────────────────────────────────────────────────────────────────────
console.log(`\nAPI FOLD — what one tool call costs (budget ${(DOC_BUDGET / 1024).toFixed(0)} KB)\n`);

const apiRoot = join(dir, "api", "v1");
const apiDocs = await jsonFiles(apiRoot);

// Every href an index document hands out, so a drill-down reached on purpose is
// not counted against the caller who asked for it.
const linked = new Set();
for (const rel of apiDocs) {
  if (!rel.endsWith("index.json")) continue;
  const doc = JSON.parse(await readFile(join(apiRoot, rel), "utf8"));
  for (const [, v] of leaves(doc)) {
    if (v.startsWith("http")) linked.add(v.replace(/^https?:\/\/[^/]+\/api\/v1\//, ""));
  }
}

for (const rel of apiDocs) {
  if (rel.startsWith("schemas/")) continue;      // served so $id resolves; not a read path
  const bytes = (await readFile(join(apiRoot, rel))).length;
  const kb = `${(bytes / 1024).toFixed(1)} KB`.padStart(8);
  if (bytes <= DOC_BUDGET) { console.log(`  ✓ ${rel.padEnd(44)} ${kb}`); continue; }
  // Folded when a sibling index covers it: corpus.json → corpus/index.json.
  const folded = apiDocs.includes(rel.replace(/\.json$/, "/index.json"));
  if (folded) {
    console.log(`  ✓ ${rel.padEnd(44)} ${kb}  folded by ${rel.replace(/\.json$/, "/index.json")}`);
  } else if (linked.has(rel)) {
    console.log(`  ✓ ${rel.padEnd(44)} ${kb}  drill-down, reached by href`);
  } else if (rel === "openapi.json") {
    console.log(`  ✓ ${rel.padEnd(44)} ${kb}  the API's own index`);
  } else {
    console.log(`  ✗ ${rel.padEnd(44)} ${kb}  over budget, no index folds it`);
    fail.push(`api/v1/${rel}: ${(bytes / 1024).toFixed(1)} KB with no index`);
  }
}

// 4 ────────────────────────────────────────────────────────────────────────────
console.log(`\nPRESENTATION FOLD — choices at rest vs. fully unfolded\n`);

for (const rel of (await htmlFiles(dir)).sort()) {
  const src = await readFile(join(dir, rel), "utf8");
  const doc = new JSDOM(src).window.document;
  const root = doc.body;
  if (!root) continue;

  const all = [...root.querySelectorAll(CHOICE)];
  if (!all.length) continue;
  const atRest = all.filter((el) => unfoldDepth(el, root) === 0);
  const maxDepth = Math.max(...all.map((el) => unfoldDepth(el, root)));
  const seeds = root.querySelectorAll("details:not([open]) > summary").length;

  // A sibling run: the choices standing at rest that share a nearest
  // choice-bearing ancestor. That container is the one expansion step a reader
  // takes, so its width is the fan-out the budget is about.
  const runs = new Map();
  for (const el of atRest) {
    const parent = runParent(el);
    if (!parent) continue;
    if (!runs.has(parent)) runs.set(parent, []);
    runs.get(parent).push(el);
  }
  const over = [...runs.entries()]
    .filter(([, els]) => els.length > FAN_OUT_MAX && els.length >= RUN_MIN)
    .filter(([parent]) => linkDensity(parent) >= CHOICE_DENSITY_MIN)
    .map(([parent, els]) => [describe(parent), els.length])
    .sort((a, b) => b[1] - a[1]);

  const route = "/" + rel.replace(/\.html$/, "").replace(/^index$/, "");
  const ratio = (atRest.length / all.length * 100).toFixed(0);
  const shape = all.length > atRest.length
    ? `${String(atRest.length).padStart(3)} at rest of ${String(all.length).padEnd(4)} (${ratio}%)  ${seeds} seed(s), depth ${maxDepth}`
    : `${String(atRest.length).padStart(3)} at rest of ${String(all.length).padEnd(4)} (unfolded — no fold)`;

  if (over.length) {
    console.log(`  ✗ ${route.padEnd(40)} ${shape}`);
    for (const [what, n] of over.slice(0, 5)) {
      console.log(`        ${what.padEnd(30)} ${n} choices in one step  (budget ${FAN_OUT_MAX})`);
    }
    if (over.length > 5) console.log(`        (+${over.length - 5} more run(s))`);
    fail.push(`${route}: ${over.length} sibling run(s) over the fan-out budget`);
  } else console.log(`  ✓ ${route.padEnd(40)} ${shape}`);
}

// ─────────────────────────────────────────────────────────────────────────────
if (fail.length) {
  console.error(`\n✗ fold-load: ${fail.length} breach(es)\n`);
  for (const f of fail) console.error(`    ${f}`);
  console.error(
    "\n  A fold that drops a rendered fact is not a summary of the page, it is a\n" +
    "  different claim about it — carry the fact in the record, or stop rendering it.\n" +
    "\n  An API document over the budget with no index costs every caller the whole\n" +
    "  set to answer one question. Give it an index that aggregates and names the\n" +
    "  drill-downs; leave the unfolded document exactly where it is.\n" +
    "\n  A sibling run over the budget is not a fold at all: it is the raw set, handed\n" +
    "  over whole. Give it a seed and a generator rule — a <details> whose summary\n" +
    "  names what is inside — or cut the run down to what the reader came for.\n",
  );
  if (strict) process.exit(1);
} else console.log("\n✓ fold-load: every fold is lossless and within budget.\n");
