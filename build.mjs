#!/usr/bin/env node
// Render the site from data/site.json (the contract) into dist/. Pure: no network,
// no GitHub — a deterministic function of site.json + the brand. Safe in `nix build`.
import { rm, mkdir, cp, access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const brand = join(root, "brand");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

if (!(await exists(join(brand, "tokens", "tokens.css")))) {
  console.error("✗ brand/ is empty. Run: git submodule update --init --recursive");
  process.exit(1);
}
const site = JSON.parse(await readFile(join(root, "data", "site.json"), "utf8"));
for (const k of ["generatedAt", "owner", "stats", "highlights"]) {
  if (!(k in site)) { console.error(`✗ site.json violates contract: missing ${k}`); process.exit(1); }
}
const profile = JSON.parse(await readFile(join(root, "data", "profile.json"), "utf8"));
for (const k of ["name", "role", "headline", "summary", "links"]) {
  if (!(k in profile)) { console.error(`✗ profile.json violates contract: missing ${k}`); process.exit(1); }
}
const linksHtml = profile.links
  .map((l) => `<a href="${esc(l.href)}">${esc(l.label)}${l.href.startsWith("http") ? "&nbsp;&#8599;" : ""}</a>`)
  .join("\n        ");

const entry = (e) =>
  `<li class="entry"><span class="entry__when">${esc(e.when)}</span><span class="entry__body">` +
  `<span class="entry__org">${esc(e.org)}${e.role ? ` · <span class="entry__role">${esc(e.role)}</span>` : ""}</span>` +
  `<span class="entry__what">${esc(e.what)}</span></span></li>`;
const exp = profile.experience ?? [];
const edu = profile.education ?? [];
const backgroundHtml =
  exp.length || edu.length
    ? `<section class="bg">
      <h2 class="bs-text-label eyebrow">Background</h2>
      ${exp.length ? `<ul class="entries">\n        ${exp.map(entry).join("\n        ")}\n      </ul>` : ""}
      ${edu.length ? `<p class="bg__sub bs-text-label">Education</p>\n      <ul class="entries">\n        ${edu.map(entry).join("\n        ")}\n      </ul>` : ""}
    </section>`
    : "";

const { stats, highlights } = site;
const langTotal = stats.languages.reduce((n, l) => n + l.count, 0) || 1;
const date = new Date(site.generatedAt).toISOString().slice(0, 10);

const langBars = stats.languages.slice(0, 6).map((l) =>
  `<div class="bar"><span class="bar__k">${esc(l.name)}</span>` +
  `<span class="bar__track"><span class="bar__fill" style="width:${Math.round((l.count / langTotal) * 100)}%"></span></span>` +
  `<span class="bar__n">${l.count}</span></div>`).join("\n        ");

const topicChips = stats.topics.length
  ? stats.topics.slice(0, 16).map((t) => `<span class="chip">${esc(t.name)} <em>${t.count}</em></span>`).join("\n        ")
  : `<span class="chip chip--muted">topics: ${stats.tagged}/${stats.public} tagged — self-labeling in progress</span>`;

const cards = highlights.map((h) => {
  const topics = (h.topics || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
  return `<li class="proj">
        <a href="${esc(h.url)}">
          <div class="proj__top"><span class="proj__name">${esc(h.name)}</span>${h.pinned ? '<span class="proj__pin">pinned</span>' : ""}</div>
          <p class="proj__desc">${esc(h.description)}</p>
          <div class="proj__meta">${h.language ? `<span class="proj__lang">${esc(h.language)}</span>` : ""}${topics}</div>
        </a>
      </li>`;
}).join("\n      ");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Robert DeLanghe — Software Engineer</title>
  <meta name="description" content="Robert DeLanghe — software engineer building agent infrastructure and capability-security systems. ${stats.repos} repositories, parsed and curated.">
  <link rel="canonical" href="https://robertdelanghe.dev/">
  <meta name="theme-color" content="#0C5A42">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://robertdelanghe.dev/">
  <meta property="og:title" content="Robert DeLanghe — Software Engineer">
  <meta property="og:description" content="Building agent infrastructure and capability-security systems — mostly in the open.">
  <link rel="stylesheet" href="brand/css/fonts.css">
  <link rel="stylesheet" href="brand/tokens/tokens.css">
  <link rel="stylesheet" href="brand/css/base.css">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow">${esc(profile.name)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${esc(profile.role)}</p>
      <h1>${esc(profile.headline)}</h1>
      <p class="lead">${esc(profile.summary)}</p>
      ${profile.place ? `<p class="place">${esc(profile.place)}</p>` : ""}
      <nav class="links">
        ${linksHtml}
      </nav>
    </header>

    ${backgroundHtml}

    <section class="corpus">
      <h2 class="bs-text-label eyebrow">The corpus</h2>
      <div class="figures">
        <div class="fig"><span class="fig__n">${stats.repos}</span><span class="fig__k">repositories</span></div>
        <div class="fig"><span class="fig__n">${stats.public}</span><span class="fig__k">public</span></div>
        <div class="fig"><span class="fig__n">${stats.sources}</span><span class="fig__k">sources</span></div>
        <div class="fig"><span class="fig__n">${stats.languages.length}</span><span class="fig__k">languages</span></div>
      </div>
      <div class="bars">
        ${langBars}
      </div>
      <div class="chips">
        ${topicChips}
      </div>
    </section>

    <section class="work">
      <h2 class="bs-text-label eyebrow">Selected work</h2>
      <ul class="projects">
      ${cards}
      </ul>
    </section>

    <footer class="foot">
      <span>Robert DeLanghe</span>
      <span class="foot__meta">github.com/bdelanghe &middot; generated ${date}</span>
    </footer>
  </main>
</body>
</html>
`;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await writeFile(join(dist, "index.html"), html);
await cp(join(root, "styles.css"), join(dist, "styles.css"));
await mkdir(join(dist, "brand"), { recursive: true });
for (const p of ["tokens/tokens.css", "css"]) {
  await cp(join(brand, p), join(dist, "brand", p), { recursive: true });
}
console.log(`✓ built dist/  — ${highlights.length} highlights, ${stats.languages.length} languages`);
