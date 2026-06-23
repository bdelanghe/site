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

const proofHtml = profile.proof?.length
  ? `<p class="proof">Proof — ${profile.proof.map((p) => `<a href="${esc(p.href)}">${esc(p.label)}</a>`).join(" · ")}</p>`
  : "";

// ---- complete <head> meta (SEO + social + agent), one source -------------------
const SITE = "https://robertdelanghe.dev";
const OG_IMAGE = `${SITE}/brand/lockup/lockup-forest-1200.png`;
const head = ({ title, description, path = "/", appCss = true }) => {
  const url = SITE + path, t = esc(title), d = esc(description);
  return `<meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t}</title>
  <meta name="description" content="${d}">
  <link rel="canonical" href="${url}">
  <meta name="theme-color" content="#0C5A42">
  <link rel="icon" type="image/png" href="/brand/favicon-32.png">
  <link rel="icon" type="image/svg+xml" href="/brand/mark/mark-forest.svg">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:title" content="${t}">
  <meta property="og:description" content="${d}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${t}">
  <meta name="twitter:description" content="${d}">
  <meta name="twitter:image" content="${OG_IMAGE}">
  <link rel="stylesheet" href="/brand/css/fonts.css">
  <link rel="stylesheet" href="/brand/tokens/tokens.css">${appCss ? `
  <link rel="stylesheet" href="/brand/css/base.css">
  <link rel="stylesheet" href="/styles.css">` : ""}`;
};
const ghHref = profile.links.find((l) => /github\.com/i.test(l.href))?.href;
const liHref = profile.links.find((l) => /linkedin/i.test(l.href))?.href;
const jsonLd = `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Person",
  name: profile.name, url: SITE, jobTitle: profile.role, description: profile.headline,
  sameAs: [ghHref, liHref].filter(Boolean),
}).replace(/</g, "\\u003c")}</script>`;

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

const s = profile.seeking;
const seekingHtml = s
  ? `<section class="seeking">
      ${s.label ? `<p class="bs-text-label seeking__label">${esc(s.label)}</p>` : ""}
      <p class="seeking__focus">${esc(s.focus)}</p>
      ${s.detail ? `<p class="seeking__detail">${esc(s.detail)}</p>` : ""}
      ${s.href ? `<a class="seeking__cta" href="${esc(s.href)}">${esc(s.cta || "Get in touch")} &rarr;</a>` : ""}
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
  ${head({ title: `${profile.name} — ${profile.role}`, description: `${profile.role} — ${profile.headline}`, path: "/" })}
  ${jsonLd}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow">${esc(profile.name)}&nbsp;&nbsp;&middot;&nbsp;&nbsp;${esc(profile.role)}</p>
      <h1>${esc(profile.headline)}</h1>
      ${profile.intro ? `<p class="lead lead--intro">${esc(profile.intro)}</p>` : ""}
      <p class="lead">${esc(profile.summary)}</p>
      ${proofHtml}
      ${profile.place ? `<p class="place">${esc(profile.place)}</p>` : ""}
      <nav class="links">
        ${linksHtml}
      </nav>
    </header>

    ${seekingHtml}

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

// ---- résumé: print-optimized static artifact from the same contract ----------
const rLinks = profile.links.filter((l) => l.href !== "/resume").map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`).join(" · ");
const rExp = (profile.experience ?? []).map((e) => `
      <div class="r-job">
        <div class="r-job__head"><span class="r-job__org">${esc(e.org)}</span><span class="r-job__when">${esc(e.when)}</span></div>
        <div class="r-job__role">${esc([e.role, e.where].filter(Boolean).join(" · "))}</div>
        <ul>${(e.bullets ?? (e.what ? [e.what] : [])).map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      </div>`).join("");
const rEdu = (profile.education ?? []).map((e) => `
      <div class="r-job"><div class="r-job__head"><span class="r-job__org">${esc(e.org)}</span><span class="r-job__when">${esc(e.when)}</span></div><div class="r-edu">${esc(e.what)}</div></div>`).join("");
const rSkills = (profile.skills ?? []).map(esc).join(" · ");
const resumeHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `${profile.name} — Résumé`, description: `Résumé — ${profile.name}, ${profile.role}.`, path: "/resume", appCss: false })}
<style>
  @page { margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: var(--bs-font-display); color: var(--bs-color-ink); max-width: 760px; margin: 28px auto; padding: 0 24px; font-size: 13px; line-height: 1.5; }
  a { color: var(--bs-color-forest); text-decoration: none; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0; }
  .r-title { font-size: 14px; color: var(--bs-color-forest); font-weight: 600; margin: 4px 0 6px; }
  .r-contact { font-family: var(--bs-font-mono); font-size: 11px; color: var(--bs-color-ink-soft); margin: 0 0 14px; }
  .r-summary { margin: 0 0 16px; }
  h2 { font-family: var(--bs-font-mono); font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--bs-color-forest); border-bottom: 1px solid var(--bs-color-line); padding-bottom: 4px; margin: 18px 0 10px; }
  .r-skills { font-size: 12px; color: var(--bs-color-ink-soft); }
  .r-job { margin: 0 0 12px; break-inside: avoid; }
  .r-job__head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .r-job__org { font-weight: 600; font-size: 14px; }
  .r-job__when { font-family: var(--bs-font-mono); font-size: 11px; color: var(--bs-color-ink-mono); white-space: nowrap; }
  .r-job__role { font-size: 12px; color: var(--bs-color-forest); margin-bottom: 4px; }
  .r-job ul { margin: 4px 0 0; padding-left: 16px; }
  .r-job li { margin: 0 0 3px; }
  .r-edu { font-size: 12px; color: var(--bs-color-ink-soft); }
  .r-print { display: inline-block; font-family: var(--bs-font-mono); font-size: 11px; color: var(--bs-color-forest); text-decoration: none; border: 1px solid var(--bs-color-line); border-radius: 6px; padding: 5px 10px; margin: 2px 0 16px; cursor: pointer; }
  .r-print:hover { border-color: var(--bs-color-forest); }
  @media print { body { margin: 0; } a { color: var(--bs-color-ink); } .r-print { display: none !important; } }
</style>
</head>
<body>
  <main>
  <header>
    <h1>${esc(profile.name)}</h1>
    <p class="r-title">${esc(profile.role)}${profile.headline ? ` — ${esc(profile.headline.replace(/\\.$/, ""))}` : ""}</p>
    <p class="r-contact">${profile.place ? esc(profile.place) + " · " : ""}${rLinks}</p>
    <a class="r-print" href="#" onclick="window.print();return false;">Download PDF&nbsp;&darr;</a>
  </header>
  <p class="r-summary">${esc(profile.summary)}</p>
  ${rSkills ? `<h2>Skills</h2><p class="r-skills">${rSkills}</p>` : ""}
  <h2>Experience</h2>${rExp}
  <h2>Education</h2>${rEdu}
  </main>
</body>
</html>
`;
await writeFile(join(dist, "resume.html"), resumeHtml);
await cp(join(root, "404.html"), join(dist, "404.html"));

// ---- /blog (placeholder until posts land; subdomain later) --------------------
const blogHtml = `<!doctype html>
<html lang="en">
<head>
${head({ title: `Writing — ${profile.name}`, description: `Writing by ${profile.name} on capability security for agentic systems.`, path: "/blog" })}
</head>
<body>
  <main class="wrap">
    <header class="intro">
      <p class="bs-text-label eyebrow">${esc(profile.name)} &nbsp;&middot;&nbsp; Writing</p>
      <h1>Writing</h1>
      <p class="lead">Long-form thinking on capability security for agentic systems lives at
        <strong><a href="https://bounded.tools" style="color:var(--bs-color-forest)">bounded.tools</a></strong> —
        the thesis, <a href="https://bounded.tools/#provenance" style="color:var(--bs-color-forest)">graded against the running code</a>. More notes will land here.</p>
      <nav class="links">
        <a href="/">&larr;&nbsp;Home</a>
        <a href="https://bounded.tools">bounded.tools&nbsp;&#8599;</a>
        <a href="https://github.com/bounded-systems">GitHub&nbsp;&#8599;</a>
      </nav>
    </header>
  </main>
</body>
</html>
`;
await writeFile(join(dist, "blog.html"), blogHtml);

await cp(join(root, "styles.css"), join(dist, "styles.css"));
await cp(join(root, "assets/logo.svg"), join(dist, "assets/logo.svg"));
await cp(join(root, "assets/og.png"), join(dist, "assets/og.png"));
await mkdir(join(dist, "brand"), { recursive: true });
for (const p of ["tokens/tokens.css", "css", "lockup", "mark", "favicon-32.png"]) {
  await cp(join(brand, p), join(dist, "brand", p), { recursive: true });
}

// ---- agent + crawler affordances, from the same contract ----------------------
const llms = `# ${profile.name}
> ${profile.headline}

${profile.summary}

${profile.role}${profile.place ? ` · ${profile.place}` : ""}

## Links
${profile.links.map((l) => `- [${l.label}](${l.href.startsWith("http") ? l.href : SITE + l.href})`).join("\n")}

## Selected work
${highlights.map((h) => `- [${h.name}](${h.url}): ${h.description}`).join("\n")}
`;
await writeFile(join(dist, "llms.txt"), llms);
await writeFile(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
await writeFile(join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  ["/", "/resume", "/blog"].map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${date}</lastmod></url>`).join("\n") +
  `\n</urlset>\n`);

console.log(`✓ built dist/  — ${highlights.length} highlights, ${stats.languages.length} languages, +meta/llms.txt/sitemap`);
