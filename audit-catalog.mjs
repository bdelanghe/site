#!/usr/bin/env node
// Derive a typed-symbol *catalog* for the shared, owned auditor
// @bounded-systems/string-audit from this site's contracts. Every shipped string becomes
// a named, typed symbol; the auditor runs type-scoped audits over it — most usefully the
// `claim` → grounding check, which flags any metric not in the curated fact registry
// (data/audit/grounding.json).
//
// This is the bdelanghe/site half of using the shared auditor: fix a rule once upstream,
// re-vendor, and the gate inherits it. This script owns only the mapping contract→catalog;
// the audit logic and the grounding check live in the vendored auditor (vendor/string-audit/),
// run by `npm run audit` (scripts/audit.mjs).
//
//   node audit-catalog.mjs            # regenerate data/audit/catalog.json
//
// Pure + dependency-free: Node builtins only. Writes one file; reads the contracts.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const readJson = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

// A string that carries a number is a measurable *claim* — route it through the
// grounding check. Narrative copy (no digits) is `body`: prose checks only, no
// grounding pressure (it asserts nothing falsifiable).
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const claimOrBody = (v) => (/\d/.test(v) ? "claim" : "body");

// data/copy.json atoms carry inline emphasis markup / entities (see its own
// "_source" note) — the auditor has no HTML awareness (vendor/string-audit/prose.mjs
// tokenizes raw text), so a tag's own attributes ("noopener", a raw URL) would read
// as unknown-dictionary words and pollute the prose/readability checks. Strip tags +
// decode entities first, same extraction copy-gate.mjs's own visibleText() does, so
// the auditor sees the same plain text a reader does.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", rarr: "→", larr: "←", darr: "↓", uarr: "↑", eacute: "é", mdash: "—", ndash: "–" };
const decodeEntities = (s) => s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e] ?? m;
});
const stripHtml = (s) => decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

function buildCatalog(profile, site, highlightCopy, copy) {
  const c = {};
  const put = (key, type, value) => {
    if (value && value.trim()) c[key] = { type, value };
  };

  // Hero + identity copy. Canonical is JSON Resume: headline/summary live under basics.
  const basics = profile.basics ?? {};
  put("hero.headline", "headline", basics.headline);
  put("hero.intro", "body", profile.intro);
  put("hero.summary", "body", basics.summary);
  if (profile.banner?.tagline) put("banner.tagline", "tagline", profile.banner.tagline);

  // Open-to-roles callout.
  if (profile.seeking?.cta) put("seeking.cta", "cta", profile.seeking.cta);
  if (profile.seeking?.focus) put("seeking.focus", "body", profile.seeking.focus);
  if (profile.seeking?.detail) put("seeking.detail", "body", profile.seeking.detail);

  // Work: the summary line and every highlight. Metric-bearing strings become
  // `claim`s so string-audit checks them against the grounding registry.
  for (const w of profile.work || []) {
    const s = slug(w.name);
    put(`exp.${s}.what`, claimOrBody(w.summary), w.summary);
    (w.highlights || []).forEach((b, i) => put(`exp.${s}.b${i}`, claimOrBody(b), b));
  }

  // Projects: the proof copy now lives here — keep it audited too.
  for (const p of profile.projects || []) {
    put(`proj.${slug(p.name)}.desc`, claimOrBody(p.description), p.description);
  }

  // Selected Work: the copy that actually ships (editorial overrides applied,
  // same as build.mjs + copy-review.mjs).
  for (const h of site.highlights || []) {
    const desc = highlightCopy[h.name] ?? h.description;
    put(`work.${slug(h.name)}`, claimOrBody(desc || ""), desc);
  }

  // Sitewide UI chrome (data/copy.json) — every page eyebrow/lede/label/footer
  // string, previously checked for ATOMICITY only (copy-gate.mjs: every visible
  // word traces to an atom) but never for prose QUALITY or grounding. This is
  // the same class of narrative claim as profile.json's (e.g. conf.lede asserts
  // what the build does), so it goes through the identical claimOrBody routing.
  for (const [key, value] of Object.entries(copy)) {
    if (key.startsWith("$") || key.startsWith("_") || typeof value !== "string") continue;
    const plain = stripHtml(value);
    put(`copy.${key}`, claimOrBody(plain), plain);
  }

  return c;
}

async function main() {
  const [canonical, presentation, site, highlightCopy, copy] = await Promise.all([
    readJson("data/profile.json"),
    readJson("data/presentation.json"),
    readJson("data/site.json"),
    readJson("data/highlight-copy.json").catch(() => ({})),
    readJson("data/copy.json"),
  ]);

  // Render-context copy (banner, intro, seeking) lives in presentation.json now;
  // merge it in so every shipped string stays audited — one bar, everywhere copy ships.
  const profile = { ...canonical, ...presentation };
  const catalog = buildCatalog(profile, site, highlightCopy, copy);
  await mkdir(join(root, "data", "audit"), { recursive: true });
  await writeFile(
    join(root, "data", "audit", "catalog.json"),
    JSON.stringify(catalog, null, 2) + "\n",
  );

  const types = Object.values(catalog).reduce((m, s) => ((m[s.type] = (m[s.type] || 0) + 1), m), {});
  const summary = Object.entries(types).map(([t, n]) => `${n} ${t}`).join(" · ");
  console.log(`audit-catalog: ${Object.keys(catalog).length} symbols → data/audit/catalog.json (${summary})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
