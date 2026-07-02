#!/usr/bin/env node
// Résumé generator — one source (resume/resume.json) → every surface.
// The same compile-and-publish model the résumé itself describes: edit the JSON,
// regenerate, and HTML / Markdown / JSON-LD can't fall out of sync. Zero deps.
//
//   node tools/build-resume.mjs           regenerate resume.{html,md,ld.json}
//   node tools/build-resume.mjs --check   exit 1 if any generated file is stale (CI)
//
// PDF is rendered from the generated HTML by tools/render-resume.mjs (it needs a
// browser, so it isn't part of this pure-Node build).
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dir = join(root, "resume");
const CHECK = process.argv.includes("--check");

const data = JSON.parse(await readFile(join(dir, "resume.json"), "utf8"));
const markSvg = await readFile(join(root, "mark", "mark-white.svg"), "utf8");
const markPath = markSvg.match(/<path d="([^"]+)"/)[1];
const markRect = markSvg.match(/<rect[^>]+\/?>(?:<\/rect>)?/)[0];

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const { basics: b } = data;

// contact row = location · affiliations · profile links · email
const contactPlain = [b.location.city, ...b.affiliations, ...b.profiles.map((p) => p.network), b.email];
const profileByNet = Object.fromEntries(b.profiles.map((p) => [p.network, p.url]));
const isLink = (label) => !!profileByNet[label] || label === b.email;
const hrefFor = (label) => (label === b.email ? `mailto:${b.email}` : profileByNet[label]);

// ── HTML ────────────────────────────────────────────────────────────────────
const jsonLd = buildJsonLd(data);
const skillsHtml = data.skills.keywords
  .map((k) => (data.skills.featured.includes(k) ? `<b>${esc(k)}</b>` : esc(k)))
  .join(" · ");

const contactHtml = contactPlain
  .map((label) =>
    isLink(label)
      ? `<li><a href="${escAttr(hrefFor(label))}">${esc(label)}</a></li>`
      : `<li>${esc(label)}</li>`
  )
  .join("\n        ");

const entryHtml = (e, org, meta) => `        <article class="r-entry">
          <div class="r-entry-head">
            <h3 class="r-org">${esc(org)}</h3>
            <span class="r-dates">${esc(e.dateRange)}</span>
          </div>
          <p class="r-meta">${esc(meta)}</p>
          <ul class="r-bullets">
${e.highlights.map((h) => `            <li>${esc(h)}</li>`).join("\n")}
          </ul>
        </article>`;

const workHtml = data.work.map((w) => entryHtml(w, w.name, `${w.position} · ${w.location}`)).join("\n\n");
const eduHtml = data.education.map((e) => entryHtml(e, e.institution, e.study)).join("\n\n");

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(b.name)} — Résumé</title>
  <meta name="description" content="${escAttr(b.name)} — ${escAttr(b.label)}. ${escAttr(b.summary)}">
  <meta name="author" content="${escAttr(b.name)}">
  <meta name="theme-color" content="#0C5A42">
  <link rel="canonical" href="${escAttr(b.url)}">

  <!-- schema.org Person — same data as resume.ld.json, generated from resume.json -->
  <script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
  </script>

  <!-- Self-hosted brand type + design tokens + resets. No external CDN:
       a bounded document holds its own fonts. -->
  <link rel="stylesheet" href="../css/fonts.css">
  <link rel="stylesheet" href="../tokens/tokens.css">
  <link rel="stylesheet" href="../css/base.css">
  <link rel="stylesheet" href="./resume.css">
</head>
<body>
  <main class="resume">
    <header class="r-head">
      <div class="r-id">
        <!-- Bounded Systems mark (white), inlined so the document is portable -->
        <svg class="r-mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" aria-hidden="true">
          <path d="${markPath}" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="butt" stroke-linejoin="round"></path>
          ${markRect}
        </svg>
        <h1 class="r-name">${esc(b.name)}</h1>
      </div>

      <p class="r-role">${esc(b.label)}</p>
      <p class="r-tagline">${esc(b.summary)}</p>

      <ul class="r-contact">
        ${contactHtml}
      </ul>
    </header>

    <div class="r-body">
      <section class="r-summary" aria-label="Summary">
${data.summaryParagraphs.map((p) => `        <p>${esc(p)}</p>`).join("\n")}
      </section>

      <section class="r-section">
        <h2 class="r-section-label">Skills</h2>
        <p class="r-skills">
          ${skillsHtml}
        </p>
      </section>

      <section class="r-section">
        <h2 class="r-section-label">Experience</h2>

${workHtml}
      </section>

      <section class="r-section">
        <h2 class="r-section-label">Education</h2>

${eduHtml}
      </section>

      <footer class="r-foot">
        <span>${esc(b.name)} — ${esc(b.label)}</span>
        <a href="${escAttr(b.url)}">${esc(b.url.replace(/^https?:\/\//, ""))}</a>
      </footer>
    </div>
  </main>
</body>
</html>
`;

// ── Markdown ─────────────────────────────────────────────────────────────────
const contactMd = contactPlain
  .map((label) => (isLink(label) ? `[${label}](${hrefFor(label)})` : label))
  .join(" · ");

const entryMd = (e, org, meta) =>
  `### ${org} — ${e.dateRange}\n${meta}\n\n${e.highlights.map((h) => `- ${h}`).join("\n")}`;

const md = `# ${b.name}
**${b.label}**

> ${b.summary}

${contactMd}

${data.summaryParagraphs.join("\n\n")}

## Skills

${data.skills.keywords.join(" · ")}

## Experience

${data.work.map((w) => entryMd(w, w.name, `${w.position} · ${w.location}`)).join("\n\n")}

## Education

${data.education.map((e) => entryMd(e, e.institution, e.study)).join("\n\n")}

---

[${b.url.replace(/^https?:\/\//, "")}](${b.url})
`;

// ── JSON-LD (schema.org Person) ──────────────────────────────────────────────
function buildJsonLd(d) {
  const x = d.basics;
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: x.name,
    jobTitle: x.label,
    description: x.summary,
    email: `mailto:${x.email}`,
    url: x.url,
    address: {
      "@type": "PostalAddress",
      addressLocality: x.location.city,
      addressRegion: x.location.region,
      addressCountry: x.location.countryCode,
    },
    sameAs: x.profiles.map((p) => p.url),
    knowsAbout: d.skills.keywords,
    worksFor: { "@type": "Organization", name: d.work[1]?.name || d.work[0]?.name },
    alumniOf: [
      ...d.education.map((e) => ({ "@type": "CollegeOrUniversity", name: e.institution })),
      { "@type": "Organization", name: "Recurse Center" },
    ],
    hasOccupation: d.work.map((w) => ({
      "@type": "Occupation",
      name: w.position,
      occupationLocation: { "@type": "Place", name: w.location },
    })),
  };
}
const ldJson = JSON.stringify(jsonLd, null, 2) + "\n";

// ── emit / check ─────────────────────────────────────────────────────────────
const outputs = [
  ["resume.html", html],
  ["resume.md", md],
  ["resume.ld.json", ldJson],
];

if (CHECK) {
  const stale = [];
  for (const [name, content] of outputs) {
    let cur = "";
    try { cur = await readFile(join(dir, name), "utf8"); } catch {}
    if (cur !== content) stale.push(name);
  }
  if (stale.length) {
    console.error(`✗ résumé build drift: ${stale.join(", ")} stale — run \`npm run resume:build\``);
    process.exit(1);
  }
  console.log("✓ résumé outputs are up to date with resume.json");
} else {
  for (const [name, content] of outputs) await writeFile(join(dir, name), content);
  console.log(`✓ generated ${outputs.map(([n]) => n).join(", ")} from resume.json`);
}
