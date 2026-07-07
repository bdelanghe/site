#!/usr/bin/env node
// Render the site from data/site.json (the contract) into dist/. Pure: no network,
// no GitHub — a deterministic function of site.json + the brand. Safe in `nix build`.
import { rm, mkdir, cp, access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateSchema } from "./vendor/conformance-kit/lib/schema-validate.mjs";
import { reprDigest, securityTxt, securityTxtExpires, webManifest, markdownSiblingHeaders } from "./vendor/conformance-kit/emitters/index.mjs";
import { buildConformanceReport, renderConformanceReport } from "./vendor/conformance-kit/gates/conformance-report.mjs";
import { evaluateAiReadability } from "./vendor/conformance-kit/gates/ai-readability-gate.mjs";
import { loadPosts } from "./posts.mjs";
import { checkCss } from "./scripts/check-css.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
// `nix build` materializes the flake-pinned brand source directly at brand/
// (see flake.nix); everywhere else (npm run build, npm run dev, CI) it's the
// @bdelanghe/brand npm dependency. Prefer brand/ when it's actually
// populated so the same build.mjs works in both without an env-detection flag.
const brand = (await exists(join(root, "brand", "tokens", "tokens.css")))
  ? join(root, "brand")
  : join(root, "node_modules", "@bdelanghe", "brand");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A handful of data/copy.json atoms carry inline emphasis markup or an HTML entity
// (see that file's own "_source" note) — fine for the HTML templates that emit them
// as-is, but a Markdown twin needs Markdown, not leaked "<strong>"/"&middot;" — a
// reader (human or the AI-readability llms.txt audience these twins exist for) would
// see the raw tag/entity as literal text. Converts the specific, small vocabulary
// these atoms actually use (a/strong/em + entities) to Markdown equivalents rather
// than stripping — an <a> becomes a real [text](href) link, not lost context.
const MD_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", rarr: "→", larr: "←", darr: "↓", uarr: "↑", eacute: "é", mdash: "—", ndash: "–" };
const mdFromHtml = (s) => String(s)
  .replace(/<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>/g, "[$2]($1)")
  .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
  .replace(/<em>(.*?)<\/em>/g, "_$1_")
  .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
    return MD_ENTITIES[e] ?? m;
  });

// Boundary guard: a template that reads a field the data doesn't have interpolates
// the literal string "undefined" into the page (e.g. a work-shaped mapper run over an
// education record). Fail the build instead of shipping it. Matches only complete
// interpolation leaks — a value rendered as a whole text node, an attribute value, or
// after a "·" separator — so prose like "undefined behavior" never trips it.
const UNDEFINED_LEAK = /(?:>\s*undefined\s*<)|(?:="undefined")|(?:·\s*undefined\s*<)/;
const writeHtml = async (file, content) => {
  const m = content.match(UNDEFINED_LEAK);
  if (m) {
    console.error(`✗ ${file}: a missing field rendered as "undefined" (${JSON.stringify(m[0])}). A template read a field name the data doesn't have.`);
    process.exit(1);
  }
  await writeFile(join(dist, file), content);
};

if (!(await exists(join(brand, "tokens", "tokens.css")))) {
  console.error("✗ brand/ and node_modules/@bdelanghe/brand are both missing. Run: npm install (or nix build, which materializes brand/ itself).");
  process.exit(1);
}
// css-token-purity gate: styles.css must speak only in brand tokens (no literal
// color, every var(--bs-*) real). The visual counterpart to the copy gate — a raw
// color can't ship, the way an untokenized string can't. See docs/css-token-purity.md.
{
  const { ok, violations, vocabSize } = await checkCss({ root, brand });
  if (!ok) {
    console.error(`✗ css-token-purity: ${violations.length} violation(s) in styles.css — every color must be a brand token (docs/css-token-purity.md):`);
    for (const v of violations) console.error(`    styles.css:${v.line}  ${v.kind}: ${v.detail}`);
    process.exit(1);
  }
  console.log(`✓ css-token-purity: 0 raw colors, all var(--bs-*) ∈ vocabulary (${vocabSize} tokens)`);
}
// Static analysis: validate both contracts against their JSON Schemas (not just
// key-presence). Invalid content can't produce a build — invalid states made
// unrepresentable at the boundary.
const loadJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const validateContract = async (name, schemaName = name) => {
  const data = await loadJson(join(root, "data", `${name}.json`));
  const schema = await loadJson(join(root, "contract", `${schemaName}.schema.json`));
  const errors = validateSchema(schema, data);
  if (errors.length) {
    console.error(`✗ ${name}.json violates contract/${schemaName}.schema.json:`);
    for (const e of errors) console.error(`    ${e}`);
    process.exit(1);
  }
  return data;
};
const site = await validateContract("site");
// The canonical résumé doc (profile) is a JSON Resume document; the homepage
// render-context doc (presentation) decorates it with hero-only fields (banner,
// intro, seeking, nav links, the decorative place line) and never redefines a
// canonical field. profile is validated against the JSON Resume schema. Shallow-merge
// (presentation last — it decorates) so the homepage templates read one `profile`
// object; /resume + /resume.json read canonical (JSON Resume) fields only.
const canonical = await validateContract("profile", "jsonresume");
const presentation = await validateContract("presentation");
const profile = { ...canonical, ...presentation };

// atomic-copy — the verbal token layer (counterpart to the brand design tokens; see
// docs/atomic-copy.md). data/copy.json holds the site's static UI chrome (eyebrows,
// section headings, figure labels, fixed prose connectors, button labels) as addressable
// copy atoms keyed by a stable dotted id. copy(id) resolves an atom and THROWS on an
// unknown id — exactly like posts.mjs interpolate({{token}}) — so a template can't
// reference copy that isn't sourced, the verbal analogue of an undefined CSS variable.
// Content that derives from the contracts (profile/presentation/site) is NOT duplicated
// here; scripts/copy-gate.mjs proves every visible word on the homepage + résumé traces
// to an atom.
const copyAtoms = await validateContract("copy");
const copy = (id) => {
  if (!Object.prototype.hasOwnProperty.call(copyAtoms, id) || id === "_source") {
    throw new Error(`copy: unknown atom id "${id}" — every user-facing string must be a copy atom in data/copy.json`);
  }
  return copyAtoms[id];
};

// JSON Resume field aliases — keep the templates readable (basics.* / work / etc.).
const basics = canonical.basics ?? {};
const name = basics.name, role = basics.label, headline = basics.headline, summary = basics.summary, email = basics.email;
const work = canonical.work ?? [];

// Anti-scrape contact. Spambots harvest plaintext `user@host` / `mailto:` straight
// from the static HTML, llms.txt, and JSON — that's the inbound "website-tools" spam.
// So we never emit the address adjacently: it ships obfuscated as
// `cv [at] robertdelanghe [dot] dev`, and EMAIL_SCRIPT re-forms the real mailto + text
// at runtime. Humans (and headless Chrome, for the résumé PDF) get a normal clickable
// link; a `\b[\w.]+@[\w.]+\.\w+` harvester finds nothing to grab. No-JS readers still
// see the human-readable obfuscated form.
const [emailUser, emailHost] = (email || "").split("@");
const emailObf = email ? `${emailUser} [at] ${emailHost.replace(/\./g, " [dot] ")}` : "";
// label omitted → the de-obfuscated address becomes the visible text (data-show).
const mailLink = ({ label = "", cls = "" } = {}) =>
  email ? `<a${cls ? ` class="${cls}"` : ""} data-mail="${esc(emailObf)}"${label ? "" : " data-show"}>${label || esc(emailObf)}</a>` : "";
const EMAIL_SCRIPT = `<script>for(const a of document.querySelectorAll('a[data-mail]')){const m=a.getAttribute('data-mail').replace(' [at] ','@').replace(/ \\[dot\\] /g,'.');a.href='mailto:'+m;if(a.hasAttribute('data-show'))a.textContent=m;}</script>`;
// On-load freshness probe for the /provenance seal: "are we the latest build?" in
// two honest senses — your view vs the live deploy (signed baked-in commit vs a
// fresh /provenance.json; same origin, a cache-freshness check not trust), and the
// deploy vs source (vs the live tip of main via the GitHub API, an authority the
// page doesn't run). JS-only; the signed stamp is the no-JS truth; silent on error.
// Written with string concatenation (no backticks / ${}) so this template literal
// doesn't interpolate it.
const FRESHNESS_SCRIPT = `<script>(async()=>{
  var el=document.getElementById("build-freshness"); if(!el) return;
  var short=function(s){return String(s||"").slice(0,7);};
  var ago=function(iso){var ms=Date.now()-Date.parse(iso); if(!isFinite(ms))return ""; return ms<36e5?Math.round(ms/6e4)+"m":ms<864e5?Math.round(ms/36e5)+"h":Math.round(ms/864e5)+"d";};
  var show=function(t){el.textContent=t; el.hidden=false;};
  try{
    var prov=await (await fetch("/provenance.json",{cache:"no-store"})).json();
    var deploy=(prov&&prov.builder&&prov.builder.commit)||"";
    var repo=(prov&&prov.builder&&prov.builder.repository)||"bdelanghe/site";
    var b=document.querySelector("[data-build-commit]");
    var baked=b?b.getAttribute("data-build-commit"):"";
    if(baked&&deploy&&baked!==deploy){show("↻ a newer build is live ("+short(deploy)+") — reload to update your view"); return;}
    var bits=["commit "+short(deploy)];
    if(prov&&prov.builtAt){var a=ago(prov.builtAt); if(a)bits.push("built "+a+" ago");}
    try{
      var res=await fetch("https://api.github.com/repos/"+repo+"/commits/main",{headers:{Accept:"application/vnd.github.sha"}});
      if(res.ok){var head=(await res.text()).trim(); if(/^[0-9a-f]{40}$/.test(head))bits.push(head===deploy?"matches main":"main is at "+short(head));}
    }catch(e){}
    show("✓ this build · "+bits.join(" · "));
  }catch(e){}
})();</script>`;
const education = canonical.education ?? [];
const skills = canonical.skills ?? [];          // grouped: [{ name, keywords }]
const projects = canonical.projects ?? [];
const googleDocsUrl = canonical.meta?.googleDocs?.publishedUrl ?? null;
// knowsAbout has no dedicated skills list to draw from — it's the same claim → evidence
// rule as `proof` above: pull terms from the work/project entries that actually earned them.
const knowsAbout = [...new Set([
  ...work.flatMap((w) => w.keywords ?? []),
  ...projects.flatMap((p) => p.keywords ?? []),
])];
const social = basics.profiles ?? [];           // [{ network, username, url }]
const place = presentation.place ?? "";         // decorative hero line (render context)
// Claim → evidence: the homepage proof line, token bag, and JSON-LD all derive from
// the canonical projects[] — one source for prx/guest-room/… instead of a duplicate list.
const proof = projects.map((p) => ({ label: p.name, href: p.url }));

// JSON Resume dates are ISO (YYYY or YYYY-MM); render them the way the human page reads.
// "2025" → "2025"; "2023-10" → "Oct 2023". fmtRange: "Oct 2023 – present" (no endDate),
// "Sep 2009 – Dec 2012".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (iso) => {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})(?:-(\d{2}))?/);
  if (!m) return String(iso);
  return m[2] ? `${MONTHS[+m[2] - 1]} ${m[1]}` : m[1];
};
const fmtRange = (start, end) =>
  start ? `${fmtDate(start)} – ${end ? fmtDate(end) : "present"}` : (end ? fmtDate(end) : "");

// Canonical token bag: brand content strings + profile slugs. Posts transclude
// facts from this ({{thesis}}, {{proof.prx}}, {{email}}) instead of re-typing them;
// an unknown token fails the build, so a claim can't cite a fact that isn't here.
const sval = (x) => (x && typeof x === "object" && "$value" in x ? x.$value : x);
const strings = (await exists(join(brand, "content", "strings.json"))) ? await loadJson(join(brand, "content", "strings.json")) : {};
const tokens = {
  org: sval(strings.name), tagline: sval(strings.tagline), thesis: sval(strings.thesis), brandDesc: sval(strings.description),
  name, role, place, headline,
  email: emailObf, // posts transclude {{email}} into prose — keep it un-harvestable too

  proof: Object.fromEntries(proof.map((p) => [p.label, p.href])),
  repo: Object.fromEntries((site.highlights || []).map((h) => [h.name, h.url])),
};
const postSchema = await loadJson(join(root, "contract", "posts.schema.json"));
const allPosts = await loadPosts(join(root, "posts"), tokens);
for (const p of allPosts) {
  const errs = validateSchema(postSchema, p.meta);
  if (errs.length) {
    console.error(`✗ posts/${p.slug}.md frontmatter violates contract/posts.schema.json:`);
    for (const e of errs) console.error(`    ${e}`);
    process.exit(1);
  }
}
// Route by target: this site is robertdelanghe.dev — render only 'dev' posts (or
// untargeted). A 'bounded-tools' draft that lands here is validated but not published.
const posts = allPosts.filter((p) => (p.meta.target ?? "dev") === "dev");
for (const p of allPosts) if ((p.meta.target ?? "dev") !== "dev") console.log(`· skipping ${p.slug} (target=${p.meta.target})`);

const linksHtml = profile.links
  .map((l) => l.href.startsWith("mailto:")
    ? mailLink({})
    : `<a href="${esc(l.href)}">${esc(l.label)}</a>`)
  .join("\n        ");

const proofHtml = proof.length
  ? `<p class="proof">${copy("proof.prefix")} ${proof.map((p) => `<a href="${esc(p.href)}">${esc(p.label)}</a>`).join(" · ")}</p>`
  : "";

// Colophon — "built with": the upstream tools that produce + validate this site,
// each a real build input or gate (see /provenance for the full signed chain), linked
// upstream. Its own page now (/colophon) rather than a homepage section — every page's
// shared footer (siteFooter, below) links to it, so it's reachable everywhere, not just
// discovered after scrolling the homepage.
const colophonListHtml = profile.colophon?.length
  ? `<ul class="colophon__list">
        ${profile.colophon.map((c) => `<li><a href="${esc(c.href)}"><span class="colophon__name">${esc(c.name)}</span>${c.role ? `<span class="colophon__role">${esc(c.role)}</span>` : ""}</a></li>`).join("\n        ")}
      </ul>`
  : "";

// ---- complete <head> meta (SEO + social + agent), one source -------------------
const SITE = basics.url || "https://robertdelanghe.dev";
const OG_IMAGE = `${SITE}/brand/lockup/lockup-accent-1200.png`;
// One source for the install/chrome colors: the <head> theme-color and the web app
// manifest read the same literals (accent fill + paper surface — the brand tokens the
// page already paints with: --bs-color-accent / --bs-color-paper) so they can't drift.
const THEME_COLOR = "#943D2A";   // --bs-color-accent
const BG_COLOR = "#EDEAE1";      // --bs-color-paper (the body background)
// RFC 9530 representation digest (`sha-256=:<base64>:`), per canonical doc, over the
// bytes build.mjs itself writes (self-contained; not the later site.sha256) —
// reprDigest is imported from the conformance kit's emitters.
// Build provenance: the commit this artifact was built from (Cloudflare/GitHub CI env).
// The footer SHA links to /provenance — the report of what produced + validated this build.
const COMMIT = process.env.CF_PAGES_COMMIT_SHA || process.env.WORKERS_CI_COMMIT_SHA || process.env.GITHUB_SHA || "";
const commitHtml = COMMIT
  ? ` &middot; <a href="/provenance" title="build provenance report">${COMMIT.slice(0, 7)}</a>`
  : ` &middot; <a href="/provenance">${copy("footer.provenance")}</a>`;

// Fingerprint CSS so it can be cached immutably: the URL changes when the content
// changes, so there's nothing stale to serve. Covers the site's own stylesheet and
// the always-loaded brand CSS (the render-blocking weight); brand is pinned via
// flake.lock, so a bump changes content → new hash → new URL. Fonts keep stable
// names + ETag — fonts.css's relative ./fonts/ url()s still resolve after rename.
const stylesCss = await readFile(join(root, "styles.css"));
const stylesHref = `/styles.${createHash("sha256").update(stylesCss).digest("hex").slice(0, 12)}.css`;

const fpBrand = async (rel) => { // rel under brand/, e.g. "css/fonts.css"
  const buf = await readFile(join(brand, rel));
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const i = rel.lastIndexOf(".");
  const fpRel = `${rel.slice(0, i)}.${hash}${rel.slice(i)}`;
  return { rel, fpRel, href: `/brand/${fpRel}`, buf };
};
const bFonts = await fpBrand("css/fonts.css");
const bTokens = await fpBrand("tokens/tokens.css");
const bBase = await fpBrand("css/base.css");

const head = ({ title, description, path = "/", appCss = true, ogTitle, ogType = "website", ogImage = OG_IMAGE, mdAlt }) => {
  const url = SITE + path, t = esc(title), d = esc(description), ot = esc(ogTitle ?? title), img = ogImage.startsWith("http") ? ogImage : SITE + ogImage;
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="${THEME_COLOR}">
  <link rel="icon" type="image/png" href="/brand/favicon-32.png">
  <link rel="icon" type="image/svg+xml" href="/brand/mark/mark-accent.svg">
  <link rel="manifest" href="/site.webmanifest">
  <meta property="og:type" content="${ogType}">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${ot}">
  <meta property="og:description" content="${d}">
  <meta property="og:image" content="${img}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:alt" content="${ot}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ot}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${img}">
  <meta name="twitter:image:alt" content="${ot}">
  <link rel="alternate" type="application/atom+xml" title="Robert DeLanghe — Writing" href="/feed.xml">
  <link rel="alternate" type="application/feed+json" title="Robert DeLanghe — Writing" href="/feed.json">${mdAlt ? `
  <link rel="alternate" type="text/markdown" href="${mdAlt}">` : ""}${social.map((s) => `
  <link rel="me" href="${esc(s.url)}">`).join("")}
  <link rel="stylesheet" href="${bFonts.href}">
  <link rel="stylesheet" href="${bTokens.href}">${appCss ? `
  <link rel="stylesheet" href="${bBase.href}">
  <link rel="stylesheet" href="${stylesHref}">` : ""}`;
};
// One source for identity: basics.profiles → sameAs (JSON-LD), rel=me (head), footer.
const socialHtml = social.map((s) => `<a rel="me" href="${esc(s.url)}">${esc(s.network)}</a>`).join(" &middot; ");
const jsonLd = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Person",
  name, url: SITE, jobTitle: role, description: headline,
  knowsAbout: knowsAbout.length ? knowsAbout : undefined,
  alumniOf: education.map((e) => ({ "@type": "Organization", name: e.institution })),
  // claim → evidence: each hero claim points at the project repo that backs it.
  subjectOf: projects.map((p) => ({ "@type": "CreativeWork", name: p.name, url: p.url })),
  sameAs: social.map((s) => s.url),
}).replace(/</g, "\\u003c")}</script>`;

// generic: link a name to its url if present (work orgs, education institutions, projects)
const linkName = (nm, url) => (url ? `<a href="${esc(url)}">${esc(nm)}</a>` : esc(nm));
const entry = (w) =>
  `<li class="entry"><span class="entry__when">${esc(fmtRange(w.startDate, w.endDate))}</span><span class="entry__body">` +
  `<span class="entry__org">${linkName(w.name, w.url)}${w.position ? ` · <span class="entry__role">${esc(w.position)}</span>` : ""}</span>` +
  `<span class="entry__what">${esc(w.summary)}</span></span></li>`;
// Education uses JSON Resume field names (institution / studyType / area) and has no
// summary — it can't share the work-shaped entry() mapper above (name/position/summary),
// or those fields render as "undefined". Mirrors /resume's rEdu: institution · degree.
const eduEntry = (e) => {
  const degree = [e.studyType, e.area].filter(Boolean).join(", ");
  return `<li class="entry"><span class="entry__when">${esc(fmtRange(e.startDate, e.endDate))}</span><span class="entry__body">` +
    `<span class="entry__org">${linkName(e.institution, e.url)}${degree ? ` · <span class="entry__role">${esc(degree)}</span>` : ""}</span>` +
    `</span></li>`;
};
const exp = work;
const edu = education;
const backgroundHtml =
  exp.length || edu.length
    ? `<section class="bg">
      <h2 class="bs-text-label eyebrow">${copy("background.eyebrow")}</h2>
      ${exp.length ? `<ul class="entries">\n        ${exp.map(entry).join("\n        ")}\n      </ul>` : ""}
      ${edu.length ? `<p class="bg__sub bs-text-label">${copy("background.education")}</p>\n      <ul class="entries">\n        ${edu.map(eduEntry).join("\n        ")}\n      </ul>` : ""}
    </section>`
    : "";

const s = profile.seeking;
const seekingHtml = s
  ? `<div class="seeking">
      ${s.label ? `<p class="bs-text-label seeking__label">${esc(s.label)}</p>` : ""}
      <p class="seeking__focus">${esc(s.focus)}</p>
      ${s.detail ? `<p class="seeking__detail">${esc(s.detail)}</p>` : ""}
      ${s.href ? (s.href.startsWith("mailto:")
        ? mailLink({ label: `${esc(s.cta || "Get in touch")} &rarr;`, cls: "seeking__cta no-link-icon" })
        : `<a class="seeking__cta no-link-icon" href="${esc(s.href)}">${esc(s.cta || "Get in touch")} &rarr;</a>`) : ""}
    </div>`
  : "";

const { stats, highlights } = site;
// Editorial copy layer: the site controls its own Selected Work descriptions,
// overriding the upstream GitHub repo description by repo name. Keeps the copy
// in this repo (the contract) instead of scattered across the source repos —
// so a description fix here, not a round-trip to another repo.
const highlightCopy = (await exists(join(root, "data", "highlight-copy.json"))) ? await loadJson(join(root, "data", "highlight-copy.json")) : {};
for (const h of highlights) {
  if (highlightCopy[h.name]) h.description = highlightCopy[h.name];
}
const date = new Date(site.generatedAt).toISOString().slice(0, 10);

// Sitewide footer — was hand-duplicated per page (four slightly different copies,
// and missing entirely from blog.html/resume.html). One function now; `extra` is the
// one real per-page variance (blog posts add RSS/all-writing links before the meta).
// The compact "Hermetic Nix build · keyless-signed…" pointer used to live ONLY in the
// homepage's inline colophon section — now every page carries it, plus a link to the
// credits list's own page (moved off the homepage to /colophon).
const siteFooter = ({ extra = "" } = {}) => `<footer class="foot">
      <span>${esc(name)} &middot; ${esc(copy("footer.org"))}</span>
      ${socialHtml ? `<span class="foot__social">${socialHtml}</span>` : ""}
      <span class="foot__meta">${extra}${copy("footer.generated")} ${date}${commitHtml}</span>
      <p class="colophon__more">${copy("colophon.more")} <a href="/provenance">${copy("colophon.provenance")}</a> &middot; <a href="/conformance">${copy("colophon.conformance")}</a> &middot; <a href="/colophon">${copy("colophon.link")}</a></p>
    </footer>`;

// in-toto materials: the build inputs, content-addressed where computable
// (pure — file hashes + the brand version, no git/network).
const sha256File = async (p) => "sha256:" + createHash("sha256").update(await readFile(p)).digest("hex");
const brandPkg = (await exists(join(brand, "package.json"))) ? await loadJson(join(brand, "package.json")) : {};
// Pin the brand to the exact commit flake.lock locks (a real sha), not just its
// version tag. flake.lock is a build input, so this stays hermetic.
const flakeLock = (await exists(join(root, "flake.lock"))) ? await loadJson(join(root, "flake.lock")) : {};
const brandRev = flakeLock?.nodes?.brand?.locked?.rev || "";
const materials = [
  // The source commit isn't known in the hermetic build; gen-attestation.mjs
  // stamps @@COMMIT_SHORT@@ at deploy time (when GITHUB_SHA is set).
  { name: "git+github.com/bdelanghe/site", id: "@@COMMIT_SHORT@@" },
  { name: "@bdelanghe/brand", id: brandRev ? brandRev.slice(0, 9) : (brandPkg.version ? `v${brandPkg.version}` : "(unpinned)") },
  { name: "data/profile.json", id: (await sha256File(join(root, "data", "profile.json"))).slice(0, 18) + "…" },
  { name: "data/presentation.json", id: (await sha256File(join(root, "data", "presentation.json"))).slice(0, 18) + "…" },
  { name: "data/site.json", id: (await sha256File(join(root, "data", "site.json"))).slice(0, 18) + "…" },
];

// short digests for the chain copy — each process step names what it ran, by sha
const dg = async (p) => (await exists(join(root, p))) ? (await sha256File(join(root, p))).slice(0, 18) + "…" : "(absent)";
const dgProfile = await dg("data/profile.json");
const dgProfileSchema = await dg("contract/jsonresume.schema.json");
const dgPresentation = await dg("data/presentation.json");
const dgPresentationSchema = await dg("contract/presentation.schema.json");
const dgPostsSchema = await dg("contract/posts.schema.json");
const dgCopyReview = await dg("copy-review.mjs");
const dgLinkedin = await dg("linkedin-check.mjs");
const dgBuild = await dg("build.mjs");
// the design system — content-addressed, not just a version string. The tokens
// (visual) + content strings (verbal) are real build inputs; attest them by digest.
for (const f of ["tokens/tokens.json", "tokens/tokens.css", "content/strings.json", "css/base.css", "css/fonts.css"]) {
  if (await exists(join(brand, f))) materials.push({ name: `brand/${f}`, id: (await sha256File(join(brand, f))).slice(0, 18) + "…" });
}

// Bars scale to the leading language (relative, not share-of-total) so the
// shape reads as rank — the top bar fills the track, the rest are proportional
// to it. (Share-of-total made every bar look stunted: 26/115 ≈ 22% full.)
const shownLangs = stats.languages.slice(0, 6);
const langMax = Math.max(...shownLangs.map((l) => l.count), 1);
const langBars = shownLangs.map((l) =>
  `<div class="bar"><span class="bar__k">${esc(l.name)}</span>` +
  `<span class="bar__track"><span class="bar__fill" style="width:${Math.round((l.count / langMax) * 100)}%"></span></span>` +
  `<span class="bar__n">${l.count}</span></div>`).join("\n        ");

const topicChips = stats.topics.length
  ? stats.topics.slice(0, 16).map((t) => `<span class="chip">${esc(t.name)} <em>${t.count}</em></span>`).join("\n        ")
  : `<span class="chip chip--muted">topics: ${stats.tagged}/${stats.public} tagged — self-labeling in progress</span>`;

// Selected work, broken out by tag — thesis tags first, the rest after.
const TAG_ORDER = ["capability-security", "agent-infra", "ai", "developer-tools", "cli", "infrastructure", "library", "nix", "web", "design-tokens"];
const tagLabel = (t) => t.replace(/-/g, " ");
const card = (h) => {
  const topics = (h.topics || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return `<li class="proj">
          <a href="${esc(h.url)}">
            <div class="proj__top"><span class="proj__name">${esc(h.name)}</span>${h.pinned ? `<span class="proj__pin">${copy("work.pinned")}</span>` : ""}</div>
            <p class="proj__desc">${esc(h.description)}</p>
            <div class="proj__meta"><span class="proj__full">${esc(h.fullName)}</span>${h.language ? `<span class="proj__lang">${esc(h.language)}</span>` : ""}${topics}</div>
          </a>
        </li>`;
};
const primaryTag = (h) => TAG_ORDER.find((t) => (h.topics || []).includes(t)) ?? (h.topics?.[0] ?? "other");
const workByTag = new Map();
for (const h of highlights) {
  const k = primaryTag(h);
  (workByTag.get(k) ?? workByTag.set(k, []).get(k)).push(h);
}
const rank = (t) => { const i = TAG_ORDER.indexOf(t); return i < 0 ? 99 : i; };
const workGroups = [...workByTag.keys()].sort((a, b) => rank(a) - rank(b)).map((k) => `
      <div class="work-group">
        <h3 class="work-group__tag">${esc(tagLabel(k))} <em>${workByTag.get(k).length}</em></h3>
        <ul class="projects">
        ${workByTag.get(k).map(card).join("\n        ")}
        </ul>
      </div>`).join("\n");

// Homepage social card (og:image): the personal home card if it's been generated
// (foregrounds the person, not the org), else the brand lockup. See .github/workflows/cards.yml.
const homeOgImage = (await exists(join(root, "assets", "cards", "home.png"))) ? "/assets/cards/home.png" : OG_IMAGE;
const html = `<!doctype html>
<html lang="en">
<head>
  ${head({ title: `${name} — ${role}`, description: `${role} — ${headline}`, path: "/", ogImage: homeOgImage, mdAlt: "/index.md" })}
  ${jsonLd}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow">${esc(name)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${esc(role)}</p>
      <h1>${esc(headline)}</h1>
      ${profile.intro ? `<p class="lead lead--intro">${esc(profile.intro)}</p>` : ""}
      <p class="lead">${esc(summary)}</p>
      ${proofHtml}
      ${place ? `<p class="place">${esc(place)}</p>` : ""}
      <nav class="links">
        ${linksHtml}
      </nav>
    </header>

    ${seekingHtml}

    ${backgroundHtml}

    <section class="corpus">
      <h2 class="bs-text-label eyebrow">${copy("corpus.eyebrow")}</h2>
      <div class="figures">
        <div class="fig"><span class="fig__n">${stats.repos}</span><span class="fig__k">${copy("corpus.fig.repositories")}</span></div>
        <div class="fig"><span class="fig__n">${stats.public}</span><span class="fig__k">${copy("corpus.fig.public")}</span></div>
        <div class="fig"><span class="fig__n">${stats.sources}</span><span class="fig__k">${copy("corpus.fig.sources")}</span></div>
        <div class="fig"><span class="fig__n">${stats.languages.length}</span><span class="fig__k">${copy("corpus.fig.languages")}</span></div>
      </div>
      <div class="bars">
        ${langBars}
      </div>
      <div class="chips">
        ${topicChips}
      </div>
      <p class="corpus__src">
        ${copy("corpus.source.computed")} <a href="https://github.com/bdelanghe">github.com/bdelanghe</a>
        &middot; <a href="https://github.com/bdelanghe?tab=stars">${copy("corpus.source.starred")}</a>
        &middot; ${copy("corpus.source.topics")} <a href="https://github.com/bdelanghe/synoptic-github">synoptic-github</a>
      </p>
    </section>

    <section class="work">
      <h2 class="bs-text-label eyebrow">${copy("work.eyebrow")}</h2>
      ${workGroups}
    </section>

    ${siteFooter()}
  </main>
  ${EMAIL_SCRIPT}
</body>
</html>
`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeHtml("index.html", html);

// ---- résumé: print-optimized static artifact from the canonical JSON Resume doc ----
// Contact line: identity profiles (basics.profiles) + the canonical email; location
// from basics.location. Affiliations live in Experience/Projects/Education.
const rEmail = email ? { mail: true } : null;
// Web profiles render as favicon + handle (no label, no full URL); email stays the
// address. Handle = last path segment (github.com/bdelanghe → bdelanghe).
const linkHost = (href) => { try { return new URL(href).hostname.replace(/^www\./, ""); } catch { return ""; } };
const linkHandle = (href) => { try { const u = new URL(href); return u.pathname.split("/").filter(Boolean).pop() || u.hostname; } catch { return href; } };
// Monochrome brand marks (simple-icons single paths), filled with the ink token —
// one high-contrast color, crisp at any size, prints with no network. Unmapped hosts
// fall back to the site's favicon.
const BRAND_ICONS = {
  "github.com": "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  "linkedin.com": "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z",
};
const brandMark = (href, label) => {
  const d = BRAND_ICONS[linkHost(href)];
  return d
    ? `<svg class="r-fav" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
    : `<img class="r-fav" src="https://${esc(linkHost(href))}/favicon.ico" alt="${esc(label)}" width="12" height="12" loading="lazy">`;
};
const rLinks = [...social.map((s) => ({ label: s.network, href: s.url })), rEmail].filter(Boolean).map((l) =>
  l.mail
    ? mailLink({})
    : /^https?:/i.test(l.href)
    ? `<a href="${esc(l.href)}" title="${esc(l.label)}">${brandMark(l.href, l.label)}${esc(linkHandle(l.href))}</a>`
    : `<a href="${esc(l.href)}">${esc(l.label)}</a>`
).join(" · ");
const rLocation = basics.location?.city
  ? [basics.location.city, basics.location.region].filter(Boolean).join(", ")
  : "";
const rExp = work.map((w) => `
      <div class="r-job">
        <div class="r-job__head"><span class="r-job__org">${linkName(w.name, w.url)}</span><span class="r-job__when">${esc(fmtRange(w.startDate, w.endDate))}</span></div>
        <div class="r-job__role">${esc([w.position, w.location].filter(Boolean).join(" · "))}</div>
        ${w.summary ? `<p class="r-job__summary">${esc(w.summary)}</p>` : ""}
        ${w.highlights?.length ? `<ul>${w.highlights.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
      </div>`).join("");
// Projects bind into one system: render a single block per entity (the umbrella) instead
// of repeating "Creator · Bounded Systems" on every repo. Each repo is a dated bullet.
const projByEntity = [];
for (const p of projects) {
  const k = p.entity || p.name;
  let g = projByEntity.find((x) => x.entity === k);
  if (!g) { g = { entity: k, items: [] }; projByEntity.push(g); }
  g.items.push(p);
}
const rProjects = projByEntity.map(({ entity, items }) => {
  const roles = [...new Set(items.flatMap((p) => p.roles ?? []))].join(" · ");
  const starts = items.map((p) => p.startDate).filter(Boolean).sort();
  const when = starts.length ? `${starts[0].slice(0, 4)} – present` : "";
  const bullets = items.map((p) => {
    const date = p.startDate ? ` · ${esc(fmtDate(p.startDate))}` : "";
    return `<li><strong>${linkName(p.name, p.url)}</strong>${date}${p.description ? ` — ${esc(p.description)}` : ""}</li>`;
  }).join("");
  return `
      <div class="r-job">
        <div class="r-job__head"><span class="r-job__org">${esc(entity)}</span>${when ? `<span class="r-job__when">${esc(when)}</span>` : ""}</div>
        ${roles ? `<div class="r-job__role">${esc(roles)}</div>` : ""}
        <ul>${bullets}</ul>
      </div>`;
}).join("");
const rEdu = education.map((e) => {
  const degree = [e.studyType, e.area].filter(Boolean).join(", ");
  return `
      <div class="r-job"><div class="r-job__head"><span class="r-job__org">${linkName(e.institution, e.url)}</span><span class="r-job__when">${esc(fmtRange(e.startDate, e.endDate))}</span></div>${degree ? `<div class="r-job__role">${esc(degree)}</div>` : ""}</div>`;
}).join("");
const rSkills = skills.map((g) =>
  g.keywords?.length
    ? `<p class="r-skill-grp"><strong>${esc(g.name)}</strong> ${g.keywords.map(esc).join(" · ")}</p>`
    : `<p class="r-skill-grp">${esc(g.name)}</p>`).join("");

// ---- /resume.json — the canonical JSON Resume doc itself (machine-readable / ATS) ----
// Near-identity emit: serve the canonical doc, stamping meta.lastModified, still
// schema-validated against the vendored JSON Resume schema. basics.headline is
// non-standard but schema-valid (basics.additionalProperties:true) — kept so
// /resume.json never diverges from the canonical.
const resumeDoc = {
  $schema: canonical.$schema ?? "https://raw.githubusercontent.com/jsonresume/resume-schema/v1.0.0/schema.json",
  ...canonical,
  // Drop the plaintext email from the published JSON — it's a stable, machine-readable
  // URL, i.e. prime scrape bait. The address still reaches humans on the rendered page
  // (obfuscated + JS-assembled). email is optional in JSON Resume, so this stays valid.
  basics: (({ email: _drop, ...rest }) => rest)(canonical.basics ?? {}),
  // Drop the internal worklog pointer — it references the private evidence base
  // (bdelanghe/worklog) and must never reach the public /resume.json. Kept in the
  // canonical doc for authoring; stripped here at the publish boundary.
  meta: (({ _worklog: _wl, ...m }) => ({ ...m, lastModified: new Date(site.generatedAt).toISOString() }))(canonical.meta ?? {}),
};
const jsonResumeSchema = await loadJson(join(root, "contract", "jsonresume.schema.json"));
const jrErrors = validateSchema(jsonResumeSchema, resumeDoc);
if (jrErrors.length) {
  console.error("✗ emitted resume.json violates contract/jsonresume.schema.json:");
  for (const e of jrErrors) console.error(`    ${e}`);
  process.exit(1);
}

const resumeHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${name} — ${copy("head.resume.label")}`, description: `${copy("head.resume.label")} — ${name}, ${role}.`, path: "/resume", appCss: false, mdAlt: "/resume.md" })}
<link rel="alternate" type="application/json" href="/resume.json" title="JSON Résumé (machine-readable)">
${jsonLd}
<style>
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: var(--bs-font-display); color: var(--bs-color-ink); max-width: 760px; margin: 28px auto; padding: 0 24px; font-size: 13px; line-height: 1.5; }
  a { color: var(--bs-color-accent); text-decoration: none; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0; }
  .r-title { font-size: 14px; color: var(--bs-color-accent); font-weight: 600; margin: 4px 0 6px; }
  .r-contact { font-family: var(--bs-font-mono); font-size: 11px; color: var(--bs-color-ink-soft); margin: 0 0 14px; }
  .r-summary { margin: 0 0 16px; }
  h2 { font-family: var(--bs-font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--bs-color-accent); border-bottom: 1px solid var(--bs-color-line); padding-bottom: 4px; margin: 18px 0 10px; }
  .r-skills { font-size: 12px; color: var(--bs-color-ink-soft); }
  .r-skill-grp { margin: 0 0 4px; font-size: 12px; color: var(--bs-color-ink-soft); }
  .r-job { margin: 0 0 12px; break-inside: avoid; }
  .r-job__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .r-job__org { font-weight: 600; font-size: 14px; }
  .r-job__when { font-family: var(--bs-font-mono); font-size: 11px; color: var(--bs-color-ink-mono); white-space: nowrap; }
  .r-job__role { font-size: 12px; color: var(--bs-color-accent); margin-bottom: 4px; }
  .r-job__summary { margin: 0 0 4px; }
  .r-job ul { margin: 4px 0 0; padding-left: 16px; }
  .r-job li { margin: 0 0 3px; }
  .r-edu { font-size: 12px; color: var(--bs-color-ink-soft); }
  .r-print { display: inline-block; font-family: var(--bs-font-mono); font-size: 11px; color: var(--bs-color-accent); text-decoration: none; border: 1px solid var(--bs-color-line); border-radius: 6px; padding: 5px 10px; margin: 2px 0 16px; cursor: pointer; }
  .r-print:hover { border-color: var(--bs-color-accent); }
  .r-print + .r-print { margin-left: 8px; }
  .r-contact .r-fav { width: 12px; height: 12px; vertical-align: -2px; margin-right: 4px; fill: var(--bs-color-ink); }
  @media print { body { margin: 0; } a { color: var(--bs-color-ink); } .r-print { display: none !important; } .r-contact .r-fav { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <main>
  <header>
    <h1>${esc(name)}</h1>
    <p class="r-title">${esc(role)}${headline ? ` · ${esc(headline.replace(/\.$/, ""))}` : ""}</p>
    <p class="r-contact">${rLocation ? esc(rLocation) + " · " : ""}${rLinks}</p>
    <a class="r-print" href="/resume.pdf" download="${name.split(" ").join("-")}-Resume.pdf">${copy("resume.download")}&nbsp;&darr;</a>
    ${googleDocsUrl ? `<a class="r-print" href="${esc(googleDocsUrl)}" target="_blank" rel="noopener">${copy("resume.comment")}</a>` : ""}
  </header>
  <p class="r-summary">${esc(summary)}</p>
  ${rSkills ? `<h2>${copy("resume.section.skills")}</h2>${rSkills}` : ""}
  <h2>${copy("resume.section.experience")}</h2>${rExp}
  ${projects.length ? `<h2>${copy("resume.section.projects")}</h2>${rProjects}` : ""}
  <h2>${copy("resume.section.education")}</h2>${rEdu}
  </main>
  ${EMAIL_SCRIPT}
</body>
</html>
`;
await writeHtml("resume.html", resumeHtml);
await writeFile(join(dist, "resume.json"), JSON.stringify(resumeDoc, null, 2) + "\n");

// ---- /provenance: what produced and validated this artifact -------------------
const provHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${copy("prov.title")} — ${name}`, description: copy("head.provenance.desc"), path: "/provenance", mdAlt: "/provenance.md" })}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow"><a href="/">&larr;&nbsp;${copy("nav.home")}</a></p>
      <h1>${copy("prov.title")}</h1>
      <p class="lead">${copy("prov.lede")}</p>
    </header>
    <section class="bg">
      <h2 class="bs-text-label eyebrow">${copy("prov.chain.eyebrow")}</h2>
      <p class="lead">${copy("prov.chain.lede")}</p>
      <ol class="prov-chain">
        <li class="prov-link"><span class="prov-link__name">${copy("prov.step.materials")}</span><div class="prov-link__body"><ul class="prov-materials">${materials.map((m) => `<li><code>${m.name}</code><span class="prov-dg">${m.id}</span></li>`).join("")}</ul><span class="prov-materials__note">${stats.repos} repos &middot; ${stats.public} public &middot; ${stats.sources} sources &middot; ${stats.languages.length} languages — these corpus figures are computed over this corpus, not asserted; the r&eacute;sum&eacute;'s outcome metrics are asserted, each grounding-checked in CI.</span></div></li>
        <li class="prov-link"><span class="prov-link__name">${copy("prov.step.contracts")}</span><span class="prov-link__body">Contracts gate content before a byte renders: the canonical résumé <code>data/profile.json</code> (<span class="prov-dg">${dgProfile}</span>) against the JSON Resume schema <code>contract/jsonresume.schema.json</code> (<span class="prov-dg">${dgProfileSchema}</span>), the render-context <code>data/presentation.json</code> (<span class="prov-dg">${dgPresentation}</span>) against <code>contract/presentation.schema.json</code> (<span class="prov-dg">${dgPresentationSchema}</span>), and every post's frontmatter against <code>contract/posts.schema.json</code> (<span class="prov-dg">${dgPostsSchema}</span>) — a non-conforming change can't build, so invalid states are unrepresentable at the boundary. Facts then transclude from canonical tokens (<code>{{thesis}}</code>, <code>{{proof.*}}</code>, <code>{{email}}</code>); an unknown token fails the build, so no claim is unsourced.</span></li>
        <li class="prov-link"><span class="prov-link__name">${copy("prov.step.gates")}</span><span class="prov-link__body">Gates run on every build, each error-severity finding blocking it: <a href="https://github.com/bounded-systems/lone"><code>lone</code></a> blesses each rendered post's DOM (semantic HTML + a11y); <code>copy-review.mjs</code> (<span class="prov-dg">${dgCopyReview}</span>) flags overclaims via Claude; <code>linkedin-check.mjs</code> (<span class="prov-dg">${dgLinkedin}</span>) verifies r&eacute;sum&eacute; claims against the saved source; <a href="https://github.com/bounded-systems/string-audit"><code>string-audit</code></a> runs the deterministic copy-hygiene suite; the structured data (<a href="https://json-ld.org" rel="noopener">JSON-LD</a> 1.1) is validated against <a href="https://www.w3.org/TR/shacl/" rel="noopener"><code>SHACL</code></a> shapes; an <strong><a href="https://spdx.dev" rel="noopener">SPDX</a> <a href="https://www.cisa.gov/sbom" rel="noopener">SBOM</a></strong> is generated and completeness-checked; and <code>@bdelanghe/brand</code> tokens are drift-checked against the committed <code>tokens.css</code>. Every gate's result is then folded — together with the SBOM and the signed <a href="https://in-toto.io" rel="noopener">in-toto</a>/<a href="https://slsa.dev" rel="noopener">SLSA</a> attestation below — into a single honest <a href="/conformance">conformance projection</a>: <a href="https://github.com/bounded-systems/lone"><code>lone</code></a>'s <code>conformance()</code> model, which emits the strong <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" rel="noopener">WCAG</a>&nbsp;2.2&nbsp;AA / OWASP&nbsp;ASVS claim <em>only</em> when every required criterion is met — manual and unsupplied criteria stay <em>not-assessed</em>, never overclaimed.</span></li>
        <li class="prov-link"><span class="prov-link__name">${copy("prov.step.builder")}</span><span class="prov-link__body">Rendered by <code>build.mjs</code> (<span class="prov-dg">${dgBuild}</span>) under a toolchain pinned by <code>flake.lock</code> — Node&nbsp;22 + <code>@bdelanghe/brand</code>${brandRev ? ` @ ${brandRev.slice(0, 9)}` : (brandPkg.version ? ` v${brandPkg.version}` : "")}. Hermetic: no network, no GitHub at build — the same materials always produce the same subject, a reproducible function of the inputs above.</span></li>
        <li class="prov-seal">
          <div class="prov-seal__card">
            <p class="prov-seal__title">${copy("prov.seal.title")}</p>
            <p class="prov-seal__meta">commit @@COMMIT@@ &middot; @@DATE@@ &middot; <a href="https://github.com/bdelanghe/site">bdelanghe/site</a></p>
            <p class="prov-seal__note" style="font-size:12px;margin:8px 0 0;color:var(--bs-color-ink);">Real <a href="https://in-toto.io" rel="noopener">in-toto</a> <code>Statement/v1</code> + <a href="https://slsa.dev" rel="noopener">SLSA</a> provenance (<a href="/attestation.intoto.json">attestation.intoto.json</a>), <strong>keyless-signed</strong> via <a href="https://sigstore.dev" rel="noopener">Sigstore</a> — a one-build <a href="https://docs.sigstore.dev/fulcio/overview/" rel="noopener">Fulcio</a> certificate minted from this workflow's GitHub <a href="https://openid.net/connect/" rel="noopener">OIDC</a> identity, logged in the public <a href="https://docs.sigstore.dev/rekor/overview/">Rekor</a> transparency log — <a href="/rekor">this build's entry</a>. No held key. The whole built site is content-addressed (<a href="/site.sha256">site.sha256</a>) and signed too, and pushed to <a href="https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry" rel="noopener">GHCR</a> as a pullable, signed <a href="https://opencontainers.org" rel="noopener">OCI</a> artifact. See <a href="/provenance.json">provenance.json</a> for digests, Rekor entries, and verify/pull recipes. This proves who built the site and that it is intact.</p>
            <p class="prov-seal__note" style="font-size:12px;margin:8px 0 0;color:var(--bs-color-ink);"><strong>Authorized.</strong> Production is not deployed straight from a build: each version is first uploaded as an un-served preview, reviewed, and <strong>promoted to production only on required human approval</strong> (the <code>site-promote</code> environment). The exact reviewed, signed version is what goes live — so the live site is not just intact, its promotion was authorized.</p>
            <p id="build-freshness" class="prov-seal__note" style="font-size:12px;margin:8px 0 0;font-family:var(--bs-font-mono);color:var(--bs-color-ink);" hidden></p>
          </div>
        </li>
      </ol>
    </section>
    ${siteFooter()}
  </main>
  ${FRESHNESS_SCRIPT}
</body>
</html>
`;
await writeHtml("provenance.html", provHtml);

// Markdown twin of /provenance — the same chain in clean prose for AI readers
// (advertised via head() mdAlt, listed in llms.txt). @@COMMIT@@/@@DATE@@ are stamped
// post-build by gen-attestation.mjs, exactly like provenance.html.
const provMd = `# ${copy("prov.title")}

> ${copy("prov.lede")}

## ${copy("prov.chain.eyebrow")}

${mdFromHtml(copy("prov.chain.lede"))}

### ${mdFromHtml(copy("prov.step.materials"))}
${materials.map((m) => `- \`${m.name}\` — ${m.id}`).join("\n")}

${stats.repos} repos · ${stats.public} public · ${stats.sources} sources · ${stats.languages.length} languages — corpus figures computed over the corpus, not asserted.

### ${mdFromHtml(copy("prov.step.contracts"))}
Contracts gate content before a byte renders: the canonical résumé \`data/profile.json\` against the JSON Resume schema, the render-context \`data/presentation.json\`, and every post's frontmatter against \`contract/posts.schema.json\` — a non-conforming change can't build. Facts transclude from canonical tokens; an unknown token fails the build, so no claim is unsourced.

### ${mdFromHtml(copy("prov.step.gates"))}
Gates run on every build, each error-severity finding blocking it: \`lone\` blesses each rendered DOM (semantic HTML + a11y); \`copy-review\` flags overclaims; \`linkedin-check\` verifies résumé claims; \`string-audit\` runs copy hygiene; JSON-LD is SHACL-validated; an SPDX SBOM is generated + completeness-checked; brand tokens are drift-checked. Every result folds into one honest [conformance projection](${SITE}/conformance) — lone's \`conformance()\` model, which emits the strong WCAG 2.2 AA / OWASP ASVS claim only when every required criterion is met; manual and unsupplied criteria stay not-assessed.

### ${mdFromHtml(copy("prov.step.builder"))}
Rendered by \`build.mjs\` under a toolchain pinned by \`flake.lock\` — Node 22 + @bdelanghe/brand${brandRev ? ` @ ${brandRev.slice(0, 9)}` : (brandPkg.version ? ` v${brandPkg.version}` : "")}. Hermetic: no network, no GitHub at build — a reproducible function of the inputs.

## ${copy("prov.seal.title")}
commit @@COMMIT@@ · @@DATE@@ · [bdelanghe/site](https://github.com/bdelanghe/site)

Real in-toto \`Statement/v1\` + SLSA provenance ([attestation.intoto.json](${SITE}/attestation.intoto.json)), keyless-signed via Sigstore — a one-build Fulcio certificate minted from this workflow's GitHub OIDC identity, logged in the public [Rekor](https://search.sigstore.dev/) transparency log. The whole built site is content-addressed ([site.sha256](${SITE}/site.sha256)) and signed, and pushed to GHCR as a pullable, signed OCI artifact. See [provenance.json](${SITE}/provenance.json) for digests, Rekor entries, and verify/pull recipes.

**Authorized.** Production is not deployed straight from a build: each version is uploaded as an un-served preview, reviewed, and promoted to production only on required human approval (the \`site-promote\` environment) — so the live site is not just intact, its promotion was authorized.
`;
await writeFile(join(dist, "provenance.md"), provMd);
// 404.html is a static template; rewrite its stylesheet refs to the fingerprinted names.
{
  let h404 = await readFile(join(root, "404.html"), "utf8");
  for (const [from, to] of [["/styles.css", stylesHref], ["/brand/css/fonts.css", bFonts.href], ["/brand/tokens/tokens.css", bTokens.href], ["/brand/css/base.css", bBase.href]]) h404 = h404.replace(from, to);
  await writeFile(join(dist, "404.html"), h404);
}

// ---- /blog: index (h-feed) + per-post pages (h-entry) from posts/*.md ---------
// Public URL is extensionless (Cloudflare serves /blog/<slug> and 307s the .html
// form to it) — so canonical/links/feeds match the URL that actually 200s. The
// file on disk keeps its .html name.
const postUrl = (p) => `/blog/${p.slug}`;
const blogIndex = posts.length
  ? `<ul class="post-list h-feed">
        ${posts.map((p) => `<li class="h-entry"><a class="u-url" href="${postUrl(p)}">
          <span class="post-list__date dt-published">${esc(p.meta.date)}</span>
          <span class="post-list__title p-name">${esc(p.meta.title)}</span>
          <span class="post-list__desc p-summary">${esc(p.meta.description)}</span>
        </a></li>`).join("\n        ")}
      </ul>`
  : `<p class="lead">${copy("blog.empty")}</p>`;

const blogHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${copy("nav.writing")} — ${name}`, description: `${copy("head.blog.desc.lead")} ${name} ${copy("head.blog.desc.tail")}`, path: "/blog", mdAlt: "/blog.md" })}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow">${esc(name)} &nbsp;&middot;&nbsp; ${copy("nav.writing")}</p>
      <h1>${copy("nav.writing")}</h1>
      <p class="lead">${copy("blog.lede")}</p>
      <nav class="links">
        <a href="/">&larr;&nbsp;${copy("nav.home")}</a>
        <a href="/feed.xml">${copy("blog.nav.rss")}</a>
        <a href="https://github.com/bounded-systems">${copy("nav.github")}</a>
      </nav>
    </header>
    <div class="posts">
      ${blogIndex}
    </div>
    ${siteFooter()}
  </main>
</body>
</html>
`;
await writeFile(join(dist, "blog.html"), blogHtml);

// Markdown twin of /blog — the post index in clean prose for AI readers.
const blogMd = `# ${copy("nav.writing")} — ${name}

> ${copy("blog.lede")}

${posts.length
  ? posts.map((p) => `## [${p.meta.title}](${SITE}${postUrl(p)})\n${p.meta.date} — ${p.meta.description}`).join("\n\n")
  : copy("blog.empty")}

---
[← ${copy("nav.home")}](${SITE}/index.md) · [${mdFromHtml(copy("blog.nav.rss"))}](${SITE}/feed.xml)
`;
await writeFile(join(dist, "blog.md"), blogMd);

await mkdir(join(dist, "blog"), { recursive: true });
const postReprs = []; // [route, Repr-Digest] for each post's canonical HTML doc
for (const p of posts) {
  const url = SITE + postUrl(p);
  // Per-article social card (og:image) if one's been generated; else the brand default.
  const ogImage = (await exists(join(root, "assets", "cards", `${p.slug}.png`))) ? `/assets/cards/${p.slug}.png` : OG_IMAGE;
  const ld = {
    "@context": "https://schema.org", "@type": "BlogPosting",
    headline: p.meta.title, datePublished: p.meta.date, description: p.meta.description,
    url, mainEntityOfPage: url, inLanguage: "en",
    author: { "@type": "Person", name: name, url: SITE },
    publisher: { "@type": "Organization", name: tokens.org || name },
    keywords: (p.meta.tags || []).length ? (p.meta.tags || []).join(", ") : undefined,
    // claim → evidence, same as the homepage Person.subjectOf.
    citation: (proof || []).map((pr) => ({ "@type": "CreativeWork", name: pr.label, url: pr.href })),
  };
  const tagsHtml = (p.meta.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  const ph = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${p.meta.title} — ${name}`, ogTitle: p.meta.title, ogType: "article", description: p.meta.description, path: postUrl(p), ogImage, mdAlt: `/blog/${p.slug}.md` })}
  <script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>
</head>
<body>
  <main class="wrap">
    <article class="post h-entry">
      <header class="post__head">
        <p class="bs-text-label eyebrow"><a href="/blog">&larr;&nbsp;${copy("nav.writing")}</a></p>
        <h1 class="p-name">${esc(p.meta.title)}</h1>
        <p class="post__meta"><time class="dt-published" datetime="${esc(p.meta.date)}">${esc(p.meta.date)}</time> &nbsp;&middot;&nbsp; <a class="p-author h-card" href="${SITE}">${esc(name)}</a>${tagsHtml ? ` &nbsp;&middot;&nbsp; ${tagsHtml}` : ""}</p>
      </header>
      <div class="post__body e-content">
      ${p.html}
      </div>
      ${(p.meta.syndication && p.meta.syndication.length) ? `<p class="post__synd">${copy("post.synd")} ${p.meta.syndication.map((u) => `<a class="u-syndication" href="${esc(u)}">${esc(new URL(u).hostname.replace(/^www\./, ""))}</a>`).join(" &middot; ")}</p>` : ""}
    </article>
    ${siteFooter({ extra: `<a href="/feed.xml">${copy("post.foot.rss")}</a> &middot; <a href="/blog">${copy("post.foot.all")}</a> &middot; ` })}
  </main>
</body>
</html>
`;
  await writeFile(join(dist, "blog", `${p.slug}.html`), ph);
  postReprs.push([postUrl(p), reprDigest(ph)]);
  // Markdown sibling — the post's frontmatter title/description + its already-interpolated
  // body source, served as text/markdown at the sibling URL (advertised via head() mdAlt).
  const postMd = `# ${p.meta.title}
${p.meta.description ? `\n> ${p.meta.description}\n` : ""}
${p.meta.date} · ${name}${(p.meta.tags || []).length ? ` · ${(p.meta.tags || []).join(", ")}` : ""}

${p.text}
`;
  await writeFile(join(dist, "blog", `${p.slug}.md`), postMd);
}

// ---- feeds: Atom + JSON Feed, WebSub hub declared (rel=hub) for push -----------
const HUB = "https://pubsubhubbub.appspot.com/";
const iso = (d) => new Date(d).toISOString();
const feedUpdated = posts[0]?.meta.date ? iso(posts[0].meta.date) : iso(site.generatedAt);
const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(name)} — Writing</title>
  <subtitle>${esc(tokens.brandDesc || headline)}</subtitle>
  <link href="${SITE}/feed.xml" rel="self"/>
  <link href="${HUB}" rel="hub"/>
  <link href="${SITE}/blog"/>
  <id>${SITE}/blog</id>
  <updated>${feedUpdated}</updated>
  <author><name>${esc(name)}</name></author>
${posts.map((p) => `  <entry>
    <title>${esc(p.meta.title)}</title>
    <link href="${SITE}${postUrl(p)}"/>
    <id>${SITE}${postUrl(p)}</id>
    <updated>${iso(p.meta.date)}</updated>
    <summary>${esc(p.meta.description)}</summary>
  </entry>`).join("\n")}
</feed>
`;
await writeFile(join(dist, "feed.xml"), atom);
const jsonFeed = {
  version: "https://jsonfeed.org/version/1.1",
  title: `${name} — Writing`,
  home_page_url: `${SITE}/blog`, feed_url: `${SITE}/feed.json`,
  description: tokens.brandDesc || headline,
  hubs: [{ type: "WebSub", url: HUB }],
  authors: [{ name: name, url: SITE }],
  items: posts.map((p) => ({ id: SITE + postUrl(p), url: SITE + postUrl(p), title: p.meta.title, summary: p.meta.description, date_published: iso(p.meta.date), tags: p.meta.tags || [] })),
};
const jsonFeedStr = JSON.stringify(jsonFeed, null, 2) + "\n";
await writeFile(join(dist, "feed.json"), jsonFeedStr);

await writeFile(join(dist, stylesHref.slice(1)), stylesCss); // fingerprinted name (see stylesHref)
await cp(join(root, "assets/logo.svg"), join(dist, "assets/logo.svg"));
await cp(join(root, "assets/og.png"), join(dist, "assets/og.png"));
if (await exists(join(root, "assets", "cards"))) await cp(join(root, "assets", "cards"), join(dist, "assets", "cards"), { recursive: true });
await mkdir(join(dist, "brand"), { recursive: true });
for (const p of ["tokens/tokens.css", "css", "lockup", "mark", "favicon-32.png"]) {
  await cp(join(brand, p), join(dist, "brand", p), { recursive: true });
}
// Replace the copied brand CSS with fingerprinted names (immutable-cacheable); the
// originals aren't referenced anywhere, so drop them. Fonts dir is untouched.
for (const f of [bFonts, bTokens, bBase]) {
  await writeFile(join(dist, "brand", f.fpRel), f.buf);
  await rm(join(dist, "brand", f.rel));
}

// ---- sibling-URL representations: Markdown twins of the rendered pages ----------
// NOT header content-negotiation — plain sibling URLs (/index.md, /resume.md,
// /blog/<slug>.md) served as text/markdown, advertised via <link rel="alternate"> in
// each page's <head> and listed in llms.txt. A deterministic function of the same
// contracts the HTML renders from. (Posts emit their .md inside the post loop above.)
const mdLink = (label, href) => `[${label}](${href.startsWith("/") ? SITE + href : href})`;
const indexMd = `# ${name} — ${role}

> ${headline}
${profile.intro ? `\n${profile.intro}\n` : ""}
${summary}
${place ? `\n${place}\n` : ""}${proof.length ? `\n## ${copy("proof.prefix").replace(/\s*[—-]\s*$/, "")}\n${proof.map((p) => `- ${mdLink(p.label, p.href)}`).join("\n")}\n` : ""}${s ? `\n## ${s.label || s.focus}\n${s.focus}${s.detail ? `\n\n${s.detail}` : ""}\n` : ""}
## ${copy("background.eyebrow")}
${work.map((w) => `- **${w.name}**${w.position ? ` · ${w.position}` : ""} (${fmtRange(w.startDate, w.endDate)})${w.summary ? ` — ${w.summary}` : ""}`).join("\n")}
${education.length ? `\n### ${copy("background.education")}\n${education.map((e) => { const d = [e.studyType, e.area].filter(Boolean).join(", "); return `- **${e.institution}**${d ? ` · ${d}` : ""} (${fmtRange(e.startDate, e.endDate)})`; }).join("\n")}\n` : ""}
## ${copy("work.eyebrow")}
${highlights.map((h) => `- ${mdLink(h.name, h.url)}: ${h.description}`).join("\n")}

## ${copy("llms.links")}
${profile.links.map((l) => l.href.startsWith("mailto:") ? `- ${emailObf}` : `- ${mdLink(l.label, l.href)}`).join("\n")}
`;
await writeFile(join(dist, "index.md"), indexMd);

const rLinksMd = social.map((sp) => mdLink(sp.network, sp.url)).join(" · ");
const rContactMd = [rLocation, rLinksMd, emailObf].filter(Boolean).join(" · ");
const resumeMd = `# ${name}

${role}${headline ? ` · ${headline.replace(/\.$/, "")}` : ""}

${rContactMd}

${summary}
${skills.length ? `\n## ${copy("resume.section.skills")}\n${skills.map((g) => g.keywords?.length ? `- **${g.name}**: ${g.keywords.join(", ")}` : `- ${g.name}`).join("\n")}\n` : ""}
## ${copy("resume.section.experience")}
${work.map((w) => `### ${w.name}${w.position ? ` — ${w.position}` : ""} (${fmtRange(w.startDate, w.endDate)})${w.location ? `\n${w.location}` : ""}${w.summary ? `\n\n${w.summary}` : ""}${(w.highlights?.length ? w.highlights : []).map((b) => `\n- ${b}`).join("")}`).join("\n\n")}
${projects.length ? `\n## ${copy("resume.section.projects")}\n${projByEntity.map(({ entity, items }) => {
  const roles = [...new Set(items.flatMap((p) => p.roles ?? []))].join(" · ");
  const starts = items.map((p) => p.startDate).filter(Boolean).sort();
  const when = starts.length ? `${starts[0].slice(0, 4)} – present` : "";
  const bullets = items.map((p) => `- **${p.name}**${p.startDate ? ` · ${fmtDate(p.startDate)}` : ""}${p.description ? ` — ${p.description}` : ""}`).join("\n");
  return `### ${entity}${when ? ` (${when})` : ""}${roles ? ` · ${roles}` : ""}\n${bullets}`;
}).join("\n\n")}\n` : ""}
## ${copy("resume.section.education")}
${education.map((e) => { const d = [e.studyType, e.area].filter(Boolean).join(", "); return `### ${e.institution}${d ? ` — ${d}` : ""} (${fmtRange(e.startDate, e.endDate)})`; }).join("\n\n")}
`;
await writeFile(join(dist, "resume.md"), resumeMd);

// ---- /.well-known/security.txt (RFC 9116) ---------------------------------------
// A machine-readable security-contact channel — the one surface where the canonical
// email ships obfuscation-free, by design (researchers need a real channel). Expires
// is stamped a year out from the corpus build date (the weekly refresh rolls it forward,
// so it never goes stale). Content-Type comes from the existing /*.txt rule.
// expires a year out from the corpus build date (the kit helper), so the weekly
// refresh rolls it forward and it never goes stale.
const securityTxtDoc = securityTxt({
  contact: `mailto:${email}`,
  expires: securityTxtExpires(site.generatedAt),
  canonical: `${SITE}/.well-known/security.txt`,
  preferredLanguages: ["en"],
});
await mkdir(join(dist, ".well-known"), { recursive: true });
await writeFile(join(dist, ".well-known", "security.txt"), securityTxtDoc);

// ---- Web App Manifest (from brand tokens; no service worker) ---------------------
const webmanifest = webManifest({
  name: `${name} — ${role}`,
  shortName: name.split(" ")[0], // ≤12-char home-screen label (PWA convention)
  description: headline,
  themeColor: THEME_COLOR,
  backgroundColor: BG_COLOR,
  display: "standalone",
  startUrl: "/",
  icons: [
    { src: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    { src: "/brand/mark/mark-accent.svg", sizes: "any", type: "image/svg+xml" },
  ],
});
await writeFile(join(dist, "site.webmanifest"), JSON.stringify(webmanifest, null, 2) + "\n");

// ---- agent + crawler affordances, from the same contract ----------------------
const llms = `# ${name}
> ${headline}

${summary}

${role}${place ? ` · ${place}` : ""}

## ${copy("llms.links")}
${profile.links.filter((l) => !l.href.startsWith("mailto:")).map((l) => `- [${l.label}](${l.href.startsWith("/") ? SITE + l.href : l.href})`).join("\n")}

## ${copy("llms.work")}
${highlights.map((h) => `- [${h.name}](${h.url}): ${h.description}`).join("\n")}
${posts.length ? `\n## ${copy("nav.writing")}\n${posts.map((p) => `- [${p.meta.title}](${SITE}${postUrl(p)}): ${p.meta.description}`).join("\n")}\n` : ""}
## ${copy("llms.md")}
- [${name} — ${role}](${SITE}/index.md)
- [${copy("head.resume.label")}](${SITE}/resume.md)
- [${copy("nav.writing")}](${SITE}/blog.md)
- [${copy("conf.title")}](${SITE}/conformance.md)
- [${copy("prov.title")}](${SITE}/provenance.md)
- [${copy("colophon.title")}](${SITE}/colophon.md)${posts.length ? "\n" + posts.map((p) => `- [${p.meta.title}](${SITE}/blog/${p.slug}.md)`).join("\n") : ""}
`;
await writeFile(join(dist, "llms.txt"), llms);

// The typed-symbol catalog + grounding registry that the audit gate runs on are
// generated by audit-catalog.mjs into data/audit/ (not emitted here) — one canonical
// catalog generator, consumed by `npm run audit` (the vendored string-audit gate).

// ---- /conformance — lone's conformance() projection over THIS build's evidence ----
// The capstone: don't just PRODUCE conformance evidence, COMPUTE and SHOW it. The
// kit's conformance-report folds lone's web-build standard (a Node port of
// jsr:@bounded-systems/lone@0.4's conformance() model) over the evidence this pure
// build can establish, and reports everything else honestly as `not-assessed`. The
// model makes overclaim impossible: the strong compact claim is emitted ONLY when
// every tier-1 required criterion is met — so automation can never print "WCAG 2.2 AA"
// or "ASVS conformant" on its own.
//
// Evidence comes from three layers, in precedence order (last wins):
//   1. data/conformance-evidence.json — the committed evidence CONTRACT: the gate
//      verdicts this site genuinely verifies (SHACL conforms, seo clean, SBOM
//      complete+signed, the signed+verified in-toto attestation, the signed site
//      manifest, the recorded IPFS CID, lone's 0-error DOM blessing). Each entry is
//      re-proven every build by a gate that BLOCKS on failure, so it can't drift from
//      reality without turning CI red (see that file's _gates map).
//   2. in-process build-facts — what THIS render self-checks and so asserts most
//      directly: RFC 9530 Repr-Digest headers (written into dist/_headers below),
//      llms.txt + the Markdown siblings, the Atom feed.
//   3. $CONFORMANCE_EVIDENCE / $CONFORMANCE_LONE_FINDINGS — a deploy/CI step may
//      override any field with a live-captured value (e.g. the real lone findings).
// HONEST: the manual + external GATING criteria (manual WCAG audit, OWASP ASVS L2,
// full axe scan, Nu HTML Checker, Core Web Vitals field data, Baseline, known-vuln
// scan, runtime reliability) are NOT supplied by any layer → they report `not-assessed`
// and the strong WCAG/ASVS compact claim stays withheld.
// AI-readability is proven by the vendored kit gate's own evaluator — one source of
// truth, re-run as a BLOCKING check in conformance.yml (check:ai-readability), not a
// bespoke self-check. It genuinely resolves llms.txt's links (the old in-process check
// conflated linksResolve with sibling presence). EVERY content page now ships a Markdown
// twin (index, resume, blog index + posts, conformance, provenance) — only 404 is exempt.
const air = await evaluateAiReadability({ dist, siblingIgnore: ["404"] });
const atomOk = /<feed[\s>]/.test(atom) && /<id>/.test(atom) && /<updated>/.test(atom) &&
  (posts.length === 0 || /<entry>/.test(atom));
const buildFacts = {
  contentDigests: { reprDigestHeaders: true },
  aiReadability: air.aiReadability,
  feeds: { atomValid: atomOk },
};
const evContract = (await exists(join(root, "data", "conformance-evidence.json")))
  ? await loadJson(join(root, "data", "conformance-evidence.json")) : {};
let confEvidence = { ...(evContract.evidence ?? {}), ...buildFacts };
let confLoneFindings = Array.isArray(evContract.loneFindings) ? evContract.loneFindings : null;
if (process.env.CONFORMANCE_EVIDENCE && await exists(process.env.CONFORMANCE_EVIDENCE))
  confEvidence = { ...confEvidence, ...await loadJson(process.env.CONFORMANCE_EVIDENCE) };
if (process.env.CONFORMANCE_LONE_FINDINGS && await exists(process.env.CONFORMANCE_LONE_FINDINGS)) {
  const f = await loadJson(process.env.CONFORMANCE_LONE_FINDINGS);
  confLoneFindings = Array.isArray(f) ? f : (f.findings ?? null);
}
const confReport = buildConformanceReport({ loneFindings: confLoneFindings, evidence: confEvidence });
await mkdir(join(dist, "api", "v1"), { recursive: true });
await writeFile(join(dist, "api", "v1", "conformance.json"), JSON.stringify(confReport, null, 2) + "\n");

// Per-criterion evidence links (consumer-injected). Each must resolve at gate time.
// Preference order: (1) a real artifact THIS build emits/serves — most direct, no
// indirection; (2) for a criterion with no servable artifact, the actual CI workflow
// that runs its gate — a public, re-runnable log of the check happening, not just an
// assertion about it; (3) only criteria with no better evidence at all fall through to
// /provenance, the signed chain that explains the gate. Previously EVERY criterion not
// in a 6-entry map fell through to /provenance regardless of whether better evidence
// existed — a criterion reporting "met" should link to what makes it true, not a
// general narrative page.
const REPO = "https://github.com/bdelanghe/site";
const BRAND_REPO = "https://github.com/bdelanghe/brand";
const CONF_EVIDENCE_LINKS = {
  // lone-derived: /api/v1/conformance.json embeds this exact criterion's real
  // `findings` array (verified above — empty array, not a placeholder, when clean).
  "html.dom-author-requirements": "/api/v1/conformance.json",
  "a11y.aria-author": "/api/v1/conformance.json",
  "a11y.wcag22-aa-auto": "/api/v1/conformance.json",
  "cognitive.complexity-budget": "/api/v1/conformance.json",

  // Real served artifacts this build emits.
  "semantic.ai-readability": "/llms.txt",
  "semantic.feeds": "/feed.xml",
  "seo.technical": "/sitemap.xml",
  "integrity.sbom": "/sbom.spdx.json",
  "integrity.slsa-provenance": "/attestation.intoto.json",
  "integrity.signed-release-manifest": "/site.sha256",
  "integrity.ipfs-cid": "/provenance.json",
  "integrity.reproducible-build": `${REPO}/blob/main/flake.lock`,

  // Design tokens: the declared contract + results, at the source (a separate repo).
  "design.palette-contrast": `${BRAND_REPO}/blob/main/tokens/token-a11y.json`,
  "design.typography": `${BRAND_REPO}/blob/main/tokens/token-a11y.json`,
  "design.target-size": `${BRAND_REPO}/blob/main/tokens/token-a11y.json`,
  "design.opacity-contrast": `${BRAND_REPO}/blob/main/tokens/token-a11y.json`,
  "design.token-likeness": `${BRAND_REPO}/blob/main/tokens/token-a11y.json`,

  // Real CI gates with no servable data artifact — link the actual workflow run.
  "html.validator-clean": `${REPO}/actions/workflows/conformance.yml`,
  "compatibility.baseline": `${REPO}/actions/workflows/conformance.yml`,
  "a11y.axe-serious-critical": `${REPO}/actions/workflows/axe.yml`,
  "a11y.agent-heuristic-review": `${REPO}/actions/workflows/a11y-heuristic.yml`,
  "cognitive.focus-budget": `${REPO}/actions/workflows/a11y-heuristic.yml`,
  "security.no-critical-vulns": `${REPO}/actions/workflows/brand-checks.yml`,
  "semantic.jsonld-shacl": `${REPO}/actions/workflows/shacl.yml`,
  "semantic.commonmark": `${REPO}/actions/workflows/seo.yml`,
};
const confEvidenceHref = (c) => CONF_EVIDENCE_LINKS[c.id] ?? "/provenance";
// Derives the evidence link's visible text FROM the href itself (not a hand-maintained
// parallel map that could drift out of sync with CONF_EVIDENCE_LINKS above) — a GitHub
// Actions workflow link reads as the workflow file, a source-file link as
// "owner/repo: path", everything else as its own path/filename. The outbound-link
// arrow is NOT appended here — that's CSS's job (styles.css: a[href^="http"]::after),
// automatic and keyed off the href, so it can't fall out of sync with what's actually
// external vs. same-origin.
const evidenceLabelFor = (href) => {
  if (href.includes("/actions/workflows/")) return `workflow: ${href.split("/").pop()}`;
  if (href.includes("/blob/")) {
    const [owner, repo, , , ...path] = href.replace("https://github.com/", "").split("/");
    return `${owner}/${repo}: ${path.join("/")}`;
  }
  return href.startsWith("/") ? href.slice(1) : href;
};
const conformanceHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${copy("conf.title")} — ${name}`, description: copy("head.conformance.desc"), path: "/conformance", mdAlt: "/conformance.md" })}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow"><a href="/">&larr;&nbsp;${copy("nav.home")}</a></p>
      <h1>${copy("conf.title")}</h1>
      <p class="lead">${copy("conf.lede")}</p>
      <p class="conf-machine"><a href="/api/v1/conformance.json">${copy("conf.machine")}</a> &middot; <a href="/provenance">${copy("conf.provenance")}</a></p>
    </header>
    ${renderConformanceReport(confReport, { evidenceHref: confEvidenceHref, evidenceLabel: (c, href) => evidenceLabelFor(href) })}
    ${siteFooter()}
  </main>
</body>
</html>
`;
await writeHtml("conformance.html", conformanceHtml);

// Markdown twin of /conformance — the full projection (claim + per-area criteria with
// status) in clean prose. The most analysis-friendly form of the report for AI readers,
// a deterministic function of the same confReport the HTML renders from.
const confMark = (s) => ({ met: "✓ met", unmet: "✗ unmet" })[s] ?? "— not-assessed";
const confAreas = [...new Set(confReport.results.map((r) => r.area))];
const conformanceMd = `# ${copy("conf.title")} — ${name}

> ${copy("conf.lede")}

**Claim:** ${confReport.claim}

**Summary:** ${confReport.summary.met} met · ${confReport.summary.unmet} unmet · ${confReport.summary.notAssessed} not-assessed · ${confReport.summary.total} total.

Machine-readable: [/api/v1/conformance.json](${SITE}/api/v1/conformance.json) · signed chain: [/provenance](${SITE}/provenance.md)

${confAreas.map((area) => `## ${area}\n${confReport.results.filter((r) => r.area === area).map((r) => {
  const href = confEvidenceHref(r);
  const evidence = href ? ` — [${evidenceLabelFor(href)}](${href.startsWith("/") ? SITE + href : href})` : "";
  return `- **${r.label}** (\`${r.id}\`) — ${confMark(r.status)}${r.required ? "" : " _(recommended)_"}${r.detail ? `: ${r.detail}` : ""}${evidence}`;
}).join("\n")}`).join("\n\n")}
`;
await writeFile(join(dist, "conformance.md"), conformanceMd);

// ---- /colophon — "built with": the credits list moved off the homepage -----------
// Was a homepage-only section; every page's shared footer now links here instead of
// requiring a scroll to the bottom of "/" to find it.
const colophonHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${copy("colophon.title")} — ${name}`, description: copy("head.colophon.desc"), path: "/colophon", mdAlt: "/colophon.md" })}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow"><a href="/">&larr;&nbsp;${copy("nav.home")}</a></p>
      <h1>${copy("colophon.title")}</h1>
      <p class="lead">${copy("colophon.lede")}</p>
    </header>
    <section class="colophon">
      ${colophonListHtml}
    </section>
    ${siteFooter()}
  </main>
</body>
</html>
`;
await writeHtml("colophon.html", colophonHtml);

const colophonMd = `# ${copy("colophon.title")} — ${name}

> ${copy("colophon.lede")}

${profile.colophon.map((c) => `- ${mdLink(c.name, c.href)}${c.role ? ` — ${c.role}` : ""}`).join("\n")}
`;
await writeFile(join(dist, "colophon.md"), colophonMd);

// Response headers (Cloudflare _headers). HTML routes have no ETag on html_handling
// routes, so without a positive max-age they re-fetch on every load — give them a
// short cache + stale-while-revalidate window. Fingerprinted CSS is immutable (the
// URL changes when content changes). Other assets keep the platform default and
// revalidate cheaply via their ETag. Rules are per-route (not a blanket /*) so no
// asset matches two Cache-Control rules — Cloudflare _headers MERGES overlapping
// rules, which would emit a malformed double Cache-Control. Plus UTF-8 on text
// assets (Cloudflare otherwise sends text/plain with no charset → Latin-1 mojibake).
const htmlRoutes = ["/", "/resume", "/blog", "/provenance", "/conformance", "/colophon", ...posts.map(postUrl)];
// RFC 9530 Repr-Digest per canonical doc, computed over the exact bytes written above
// (self-contained — not the later site.sha256). Scoped to the canonical documents, not
// fingerprinted assets. /provenance is intentionally OMITTED: gen-attestation.mjs stamps
// @@COMMIT@@/@@DATE@@ into provenance.html AFTER this build, so a build-time digest would
// not match the served bytes. The digest is added in the SAME rule block as Cache-Control
// (Cloudflare _headers merges overlapping rules — one block per route avoids duplication).
const reprByRoute = {
  "/": reprDigest(html),
  "/resume": reprDigest(resumeHtml),
  "/blog": reprDigest(blogHtml),
  "/conformance": reprDigest(conformanceHtml),
  ...Object.fromEntries(postReprs),
  "/feed.xml": reprDigest(atom),
  "/feed.json": reprDigest(jsonFeedStr),
};
const reprLine = (r) => (reprByRoute[r] ? `\n  Repr-Digest: ${reprByRoute[r]}` : "");
await writeFile(join(dist, "_headers"),
  htmlRoutes.map((r) => `${r}\n  Cache-Control: public, max-age=600, stale-while-revalidate=3600${reprLine(r)}`).join("\n") +
  `\n/feed.xml\n  Repr-Digest: ${reprByRoute["/feed.xml"]}\n` +
  `/feed.json\n  Repr-Digest: ${reprByRoute["/feed.json"]}\n` +
  `/styles.*.css\n  Cache-Control: public, max-age=31536000, immutable\n` +
  `/brand/css/*.css\n  Cache-Control: public, max-age=31536000, immutable\n` +
  `/brand/tokens/*.css\n  Cache-Control: public, max-age=31536000, immutable\n` +
  `/*.txt\n  Content-Type: text/plain; charset=utf-8\n` +
  `/*.pub\n  Content-Type: text/plain; charset=utf-8\n` +
  // Markdown siblings + the web app manifest Content-Type rules (kit emitter). /*.md
  // greedily matches /blog/<slug>.md too; neither overlaps an existing Content-Type
  // rule, so no double-header merge.
  markdownSiblingHeaders());
await writeFile(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
await writeFile(join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  htmlRoutes.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${date}</lastmod></url>`).join("\n") +
  `\n</urlset>\n`);

console.log(`✓ built dist/  — ${highlights.length} highlights, ${stats.languages.length} languages, +meta/llms.txt/sitemap`);
