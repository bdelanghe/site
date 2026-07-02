#!/usr/bin/env node
// Résumé asset tests — structural + brand invariants. Zero deps (Node only).
//
// Same idiom as coverage.mjs / content.mjs / a11y.mjs: print each assertion,
// exit non-zero under --check so CI gates on it. These are the guarantees that
// make the résumé a *bounded* document — it can't silently drift from the
// design system, lose its print rules, or ship a dangling token / dead link.
//
// Usage:
//   node tools/resume-check.mjs            report (always exit 0)
//   node tools/resume-check.mjs --check    exit 1 if any assertion fails (CI gate)
//   node tools/resume-check.mjs --pdf <f>  also validate a rendered PDF
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const resumeDir = join(root, "resume");
const args = process.argv.slice(2);
const CHECK = args.includes("--check");
const pdfIdx = args.indexOf("--pdf");
const pdfPath = pdfIdx !== -1 ? args[pdfIdx + 1] : null;

const html = await readFile(join(resumeDir, "resume.html"), "utf8");
const css = await readFile(join(resumeDir, "resume.css"), "utf8");
const md = await readFile(join(resumeDir, "resume.md"), "utf8");
const ldRaw = await readFile(join(resumeDir, "resume.ld.json"), "utf8");
const source = JSON.parse(await readFile(join(resumeDir, "resume.json"), "utf8"));
const tokensCss = await readFile(join(root, "tokens", "tokens.css"), "utf8");

const results = [];
const ok = (name) => results.push({ name, pass: true });
const fail = (name, detail) => results.push({ name, pass: false, detail });
const assert = (cond, name, detail) => (cond ? ok(name) : fail(name, detail));

// ── 1. linked assets resolve on disk ──────────────────────────────────────
const links = [...html.matchAll(/<link[^>]+href="([^"]+)"[^>]*>/g)]
  .map((m) => m[1])
  .filter((h) => !/^https?:|^mailto:/.test(h)); // skip preconnect/external + canonical
const missing = links.filter((h) => !existsSync(resolve(resumeDir, h)));
assert(links.length >= 4, "links ≥4 local stylesheets referenced", `found ${links.length}`);
assert(missing.length === 0, "every linked stylesheet exists", missing.join(", "));

// ── 2. brand colour invariant: ZERO raw hex in resume.css (all from tokens) ─
const rawHex = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
assert(rawHex.length === 0, "no raw hex in resume.css — every colour is a token", rawHex.join(", "));

// ── 3. token integrity: every var() ref is defined ────────────────────────
const definedBs = new Set([...tokensCss.matchAll(/(--bs-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const definedLocal = new Set([...css.matchAll(/(--r-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
const usedVars = [...css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)].map((m) => m[1]);
const dangling = [...new Set(usedVars)].filter((v) =>
  v.startsWith("--bs-") ? !definedBs.has(v) : v.startsWith("--r-") ? !definedLocal.has(v) : true
);
assert(usedVars.length > 0, "resume.css references design tokens", "no var() usage found");
assert(dangling.length === 0, "no dangling token references", dangling.join(", "));

// ── 4. print invariants — the whole point of the static asset ─────────────
const printChecks = [
  [/@page\b/, "@page rule"],
  [/size:\s*Letter/i, "size: Letter"],
  [/@media\s+print/, "@media print block"],
  [/print-color-adjust:\s*exact/, "print-color-adjust: exact"],
  [/break-inside:\s*avoid/, "break-inside: avoid (entries don't split)"],
];
for (const [re, label] of printChecks)
  assert(re.test(css), `print rule present — ${label}`, "missing from resume.css");

// ── 5. structure & content ────────────────────────────────────────────────
assert(/<html[^>]+lang="/.test(html), "html has lang attribute");
assert(/name="viewport"/.test(html), "viewport meta present");
assert(/<title>[^<]*Robert DeLanghe/.test(html), "title names the candidate");
for (const label of ["Skills", "Experience", "Education"])
  assert(new RegExp(`r-section-label[^>]*>\\s*${label}`, "i").test(html), `section present — ${label}`);
const orgs = ["Bounded Systems", "Aura", "L2L", "Pioneer Works", "Kaleida Studio", "The Prepared", "Recurse Center", "Bennington College"];
for (const org of orgs)
  assert(new RegExp(`r-org[^>]*>\\s*${org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(html), `experience entry — ${org}`);
assert(/href="mailto:[^"]+@[^"]+"/.test(html), "contact email is a mailto link");

// ── 6. no empty / placeholder anchors ─────────────────────────────────────
const anchors = [...html.matchAll(/<a\s+href="([^"]*)"/g)].map((m) => m[1]);
const badHrefs = anchors.filter((h) => !h.trim() || h === "#");
assert(anchors.length > 0, "résumé has links", "no anchors found");
assert(badHrefs.length === 0, "no empty/placeholder (#) hrefs", badHrefs.join(", "));

// ── 7. inlined mark can't drift from the brand asset ──────────────────────
const markSvg = await readFile(join(root, "mark", "mark-white.svg"), "utf8");
const markPath = markSvg.match(/<path d="([^"]+)"/)?.[1];
const htmlPaths = [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
assert(!!markPath && htmlPaths.includes(markPath), "inlined header mark matches mark/mark-white.svg",
  "the <svg> in resume.html drifted from the brand mark");

// ── 8. Markdown surface mirrors the source ────────────────────────────────
assert(md.startsWith(`# ${source.basics.name}`), "resume.md leads with the candidate H1");
for (const label of ["## Skills", "## Experience", "## Education"])
  assert(md.includes(label), `resume.md section — ${label}`);
const mdOrgs = [...source.work.map((w) => w.name), ...source.education.map((e) => e.institution)];
const mdMissing = mdOrgs.filter((o) => !md.includes(`### ${o} —`));
assert(mdMissing.length === 0, "resume.md lists every org/school as a heading", mdMissing.join(", "));

// ── 9. JSON-LD is valid schema.org Person, in sync with the source ────────
let ld = null;
try { ld = JSON.parse(ldRaw); } catch (e) { fail("resume.ld.json is valid JSON", e.message); }
if (ld) {
  assert(ld["@context"] === "https://schema.org", "JSON-LD @context is schema.org");
  assert(ld["@type"] === "Person", "JSON-LD @type is Person");
  assert(ld.name === source.basics.name, "JSON-LD name matches source");
  assert(Array.isArray(ld.sameAs) && ld.sameAs.length === source.basics.profiles.length,
    "JSON-LD sameAs covers every profile", `${ld.sameAs?.length} vs ${source.basics.profiles.length}`);
  assert(Array.isArray(ld.knowsAbout) && ld.knowsAbout.length === source.skills.keywords.length,
    "JSON-LD knowsAbout covers every skill");
}

// ── 10. HTML embeds the SAME JSON-LD (structured data can't drift) ────────
const embedded = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
let embedOk = false;
try { embedOk = embedded && JSON.stringify(JSON.parse(embedded)) === JSON.stringify(ld); } catch {}
assert(embedOk, "HTML's embedded JSON-LD equals resume.ld.json", "embedded structured data drifted");

// ── 11. optional: validate a rendered PDF ─────────────────────────────────
if (pdfPath) {
  if (!existsSync(pdfPath)) {
    fail("rendered PDF exists", pdfPath);
  } else {
    const buf = await readFile(pdfPath);
    const head = buf.subarray(0, 5).toString("latin1");
    const text = buf.toString("latin1");
    const pages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert(head === "%PDF-", "PDF has a valid header", `got ${head}`);
    assert(buf.length > 10_000, "PDF is non-trivial in size", `${buf.length} bytes`);
    assert(pages >= 1 && pages <= 4, "PDF page count is sane (1–4)", `${pages} pages`);
  }
}

// ── report ────────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.pass).length;
console.log("\n  RÉSUMÉ ASSET TESTS\n  " + "─".repeat(48));
for (const r of results)
  console.log(`     ${r.pass ? "✓" : "✗"} ${r.name}${r.pass ? "" : `  —  ${r.detail || ""}`}`);
console.log(`\n  ${passed}/${results.length} passed\n`);

const failures = results.filter((r) => !r.pass);
if (CHECK && failures.length) {
  console.error(`✗ résumé tests: ${failures.length} assertion(s) failed`);
  process.exit(1);
}
