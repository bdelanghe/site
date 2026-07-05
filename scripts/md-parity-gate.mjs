#!/usr/bin/env node
// Word-coverage check between each built HTML page and its Markdown twin (the
// ai-readability-gate only checks that a .md SIBLING FILE exists, never that it
// carries the same content — this catches the harder failure: a twin that exists
// but silently drops a section). A REPORT-ONLY signal, not a proof of losslessness
// (word-overlap is a heuristic, not a real diff) — mirrors readability-gate.mjs's
// own WARN-by-default / --strict framing. Some gap is expected and fine: nav chrome,
// footer meta, and interactive-only elements are legitimately HTML-only.
//
//   node scripts/md-parity-gate.mjs dist            # report (WARN-only, exit 0)
//   node scripts/md-parity-gate.mjs dist --strict   # fail below the coverage floor
import { readFile, readdir } from "node:fs/promises";
import { join, dirname, basename } from "node:path";

const dist = process.argv[2];
const strict = process.argv.includes("--strict");
if (!dist) { console.error("usage: node scripts/md-parity-gate.mjs <dist> [--strict]"); process.exit(1); }

// Pages that legitimately have no Markdown twin (matches ai-readability-gate's
// AIR_SIBLING_IGNORE convention) — an error page isn't content.
const EXEMPT = new Set(["404"]);

// ---- HTML visible text (mirrors scripts/copy-gate.mjs's own extraction) --------
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", rarr: "→", larr: "←", darr: "↓", uarr: "↑", eacute: "é", mdash: "—", ndash: "–" };
const decode = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e] ?? m;
});
const htmlText = (html) => decode(html
  .replace(/<head[\s\S]*?<\/head>/i, " ")
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " "));

// ---- Markdown plain text --------------------------------------------------------
// Structural markers only — NOT a blanket char-class strip. A blanket strip of "-"
// would split "commerce-routing" into "commerce"/"routing", a false mismatch against
// the HTML side (which keeps the hyphen), since the two token sets would never align.
const mdText = (md) => md
  .replace(/```[\s\S]*?```/g, " ")           // fenced code (own vocabulary, e.g. digests)
  .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")     // images
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // links -> label text
  .replace(/^#{1,6}\s+/gm, "")               // heading markers
  .replace(/^>\s?/gm, "")                    // blockquote markers
  .replace(/^\s*[-*]\s+/gm, "")              // list-item markers (line-initial only)
  .replace(/^\s*---+\s*$/gm, " ")            // horizontal rules
  .replace(/[*_`]/g, "");                    // emphasis/code markers

// Significant words only: short/common words trip false positives (a MD reflow
// dropping "the" means nothing; dropping "grounding" or a heading term does).
const STOP = new Set(["this","that","with","from","have","been","were","which","their","about","after","before","would","could","should","there","where","when","what","into","over","under","than","then","also","just","only","more","most","some","such","each","every","both","either","neither","not","and","the","for","are","was","its","our","your","they","them","these","those","will","can","may","must"]);
const words = (t) => new Set((t.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).map((w) => w.replace(/['-]+$/, "")).filter((w) => !STOP.has(w)));

const COVERAGE_FLOOR = 0.75; // below this, something real probably got dropped

async function main() {
  const entries = await readdir(dist, { withFileTypes: true });
  const pages = [];
  const walk = async (dir, prefix) => {
    for (const e of await readdir(join(dist, dir), { withFileTypes: true })) {
      if (e.isDirectory()) { await walk(join(dir, e.name), `${prefix}${e.name}/`); continue; }
      if (e.name.endsWith(".html")) pages.push(join(dir, e.name));
    }
  };
  await walk("", "");

  let worst = 0;
  const rows = [];
  for (const rel of pages) {
    const slug = basename(rel, ".html");
    if (EXEMPT.has(slug)) continue;
    const mdRel = join(dirname(rel), `${slug}.md`);
    let mdRaw;
    try { mdRaw = await readFile(join(dist, mdRel), "utf8"); }
    catch { rows.push({ rel, coverage: 0, missing: ["(no .md sibling)"], total: 0 }); worst = Math.max(worst, 1); continue; }

    const htmlRaw = await readFile(join(dist, rel), "utf8");
    const htmlWords = words(htmlText(htmlRaw));
    const mdWords = words(mdText(mdRaw));
    const missing = [...htmlWords].filter((w) => !mdWords.has(w));
    const coverage = htmlWords.size ? 1 - missing.length / htmlWords.size : 1;
    rows.push({ rel, coverage, missing, total: htmlWords.size });
    worst = Math.max(worst, 1 - coverage);
  }

  console.log("\n  MD-PARITY — word coverage, HTML -> its Markdown twin");
  console.log("  " + "─".repeat(60));
  for (const r of rows.sort((a, b) => a.coverage - b.coverage)) {
    const pct = Math.round(r.coverage * 100);
    const mark = r.coverage >= COVERAGE_FLOOR ? "✓" : "✗";
    console.log(`  ${mark} ${r.rel.padEnd(45)} ${pct}% (${r.total} sig. word(s), ${r.missing.length} missing)`);
    if (r.coverage < COVERAGE_FLOOR && r.missing.length) {
      console.log(`      missing: ${r.missing.slice(0, 12).join(", ")}${r.missing.length > 12 ? ", …" : ""}`);
    }
  }
  const bad = rows.filter((r) => r.coverage < COVERAGE_FLOOR);
  console.log(`\n  ${bad.length} page(s) below the ${Math.round(COVERAGE_FLOOR * 100)}% floor · ${rows.length} checked\n`);

  if (bad.length && strict) {
    console.error(`✗ md-parity-gate: ${bad.length} page(s) likely dropped content in their Markdown twin`);
    process.exit(1);
  }
  console.log(bad.length ? "⚠ md-parity-gate: report-only, not failing (run --strict to block)" : "✓ md-parity-gate: every page's Markdown twin covers its HTML content");
}

main().catch((err) => { console.error(err); process.exit(1); });
