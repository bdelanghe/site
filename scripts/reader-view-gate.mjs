#!/usr/bin/env node
// reader-view gate — does a reader mode actually get this page's CONTENT?
//
// Firefox Reader runs Mozilla's Readability, and so does this gate — the same library,
// over the same built HTML, which makes "renders in Reader" a measured property of the
// artifact instead of something you check by hand on a phone and then never check again.
//
// SAFARI IS NOT THIS LIBRARY, and an earlier version of this comment wrongly said it was.
// WebKit ships its own reader, historically derived from Readability but maintained
// separately, and it is measurably STRICTER. Checked against Safari Reader print-to-PDF
// of the live pages, it culled content this library keeps:
//
//   "Empathic — New York" + the contact address (/)     kept here, dropped by Safari
//   the repository names prx / guest-room / … (/archive) kept here, dropped by Safari
//
// The common factor is short, link-dense blocks — a two-row <dl> of links, or a card
// header that is a bare <a> plus two <span>s. Both engines cull on link density; Safari's
// threshold is lower. So treat a pass here as NECESSARY, NOT SUFFICIENT: it proves
// Firefox and any Readability-based tool get the page, and it will catch the gross
// failures (a <span> narrative, an unoffered page), but it cannot certify Safari.
//
// The guaranteed reading surface is not Reader at all — it is the Markdown twin
// (/index.md, /archive.md), which is lossless, deterministic, and covered by
// md-parity-gate. Reader is best-effort by construction: an undocumented per-browser
// heuristic we can influence and cannot control. Chasing one engine's exact thresholds
// is not a fixable problem, so this gate deliberately measures the floor, not the ceiling.
//
// WHY THIS EXISTS. /provenance shipped with its entire provenance-chain narrative
// wrapped in <span>. Readability scores only p / td / pre / section / h2-h6 — a <span>
// is invisible to its scorer — so the chain scored zero, the surrounding <ol> was culled
// by _cleanConditionally as a link-dense list with no content, and Reader rendered the
// page as a bare column of sha256 digests. 568 characters out of ~4,000. Nothing caught
// it: every a11y gate was green, because a <span> of prose is perfectly accessible. The
// DOM was fine and the page was still unreadable in the one mode people reach for when
// they want to actually read something.
//
// WHAT IT MEASURES. Two things, because they fail independently:
//
//   offered — isProbablyReaderable(): whether a browser will show the Reader control at
//             all. It counts <p>/<pre>/<article> nodes carrying real text, so a page
//             built from <section>s and <dl>s can be perfectly extractable and still
//             never surface the button. Wrapping each page's content in <article> is
//             what flipped this true site-wide.
//   coverage — the ratio of Readability-extracted text to the page's own
// visible body text. Absolute length is the wrong metric — a short page is not a broken
// page — so this is coverage, not volume. A page that Reader renders faithfully scores
// near 1; the /provenance failure scored 0.14.
//
// This is NOT a claim that the page reads well, only that a reader mode can SEE it.
// Prose quality is scripts/readability-gate.mjs (a reading-grade signal) and the
// string-audit suite; those measure the words, this measures whether the words survive
// extraction at all.
//
//   node scripts/reader-view-gate.mjs dist            # report (exit 0)
//   node scripts/reader-view-gate.mjs dist --strict   # gate: exit 1 below the floor
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { JSDOM } from "jsdom";
import { Readability, isProbablyReaderable } from "@mozilla/readability";

const dist = process.argv[2] ?? "dist";
const STRICT = process.argv.includes("--strict");

// The floor. Chosen from measurement, not taste: every content page on this site clears
// 0.55 once its prose is in real paragraphs, and the /provenance regression that
// prompted this gate sat at 0.14. Set between the two, nearer the failure, so the gate
// catches a page falling out of Reader without firing on ordinary layout churn.
const FLOOR = 0.55;

// Pages exempt from the floor, each for a stated reason — no silent partial coverage.
// These are navigational surfaces: their body IS a list of links, so there is no article
// for Reader to find and nothing is broken when it doesn't find one. They are still
// measured and reported, just not gated.
const NAV_ONLY = new Map([
  ["404.html", "error page — no content by design"],
  ["blog.html", "post index — a list of links, not an article"],
  ["colophon.html", "credits index — a list of links, not an article"],
]);

const visibleText = (html) =>
  html
    .replace(/<head[\s\S]*?<\/head>/i, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-zA-Z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function pagesUnder(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!["brand", "assets", "api", ".well-known"].includes(e.name)) await pagesUnder(p, out);
    } else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}

export async function checkReaderView(distDir) {
  const rows = [];
  for (const file of (await pagesUnder(distDir)).sort()) {
    const html = await readFile(file, "utf8");
    const rel = relative(distDir, file);
    const visible = visibleText(html).length;
    let extracted = 0;
    try {
      const dom = new JSDOM(html, { url: "https://robertdelanghe.dev/" });
      const parsed = new Readability(dom.window.document).parse();
      extracted = (parsed?.textContent ?? "").replace(/\s+/g, " ").trim().length;
    } catch {
      extracted = 0; // a throw IS the failure mode — Reader would show nothing
    }
    let offered = false;
    try {
      offered = isProbablyReaderable(new JSDOM(html).window.document);
    } catch { offered = false; }
    const ratio = visible > 0 ? extracted / visible : 1;
    const exempt = NAV_ONLY.get(rel) ?? null;
    const pass = exempt != null || (ratio >= FLOOR && offered);
    rows.push({ rel, visible, extracted, ratio, offered, exempt, pass });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await checkReaderView(dist);
  console.log(`\n  READER VIEW — Readability coverage (floor ${FLOOR})\n  ${"─".repeat(58)}`);
  for (const r of rows) {
    const mark = r.exempt ? "·" : r.pass ? "✓" : "✗";
    console.log(
      `  ${mark} ${r.rel.padEnd(46)} ${(r.ratio * 100).toFixed(0).padStart(3)}%  ` +
        `${String(r.extracted).padStart(5)}/${String(r.visible).padEnd(6)} ` +
        `${r.offered ? "offered" : "NOT-OFFERED"}`.padEnd(12) +
        (r.exempt ? `  (not gated: ${r.exempt})` : ""),
    );
  }
  const failed = rows.filter((r) => !r.pass);
  const gated = rows.filter((r) => !r.exempt).length;
  console.log(
    `\n  ${gated} content page(s) gated · ${rows.length - gated} navigational page(s) reported only\n` +
      "  Evidence type: Mozilla Readability extraction — the engine Safari/Firefox Reader use.\n" +
      "  It measures whether a reader mode can SEE the content, NOT whether the prose reads well.",
  );
  if (failed.length) {
    console.error(`\n✗ reader-view gate: ${failed.length} page(s) below the ${FLOOR} floor:`);
    for (const r of failed) {
      console.error(
        `    ${r.rel} — ${(r.ratio * 100).toFixed(0)}% (${r.extracted}/${r.visible} chars)` +
          `${r.offered ? "" : ", and Reader is NOT OFFERED (no <article>/<p> carrying real text)"}. ` +
          "Most often: prose in <span>/<div> instead of <p>, or a link-dense <ul>/<ol> " +
          "carrying the narrative — Readability scores p/td/pre/section/h2-h6 and culls " +
          "the rest.",
      );
    }
    if (STRICT) process.exit(1);
    console.error("  (report-only; pass --strict to block)");
  } else {
    console.log("\n✓ reader-view gate: every content page survives Readability extraction.");
  }
}
