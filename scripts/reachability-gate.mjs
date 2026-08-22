#!/usr/bin/env node
// reachability gate — can a reader actually GET to every page this build ships?
//
// A page can be rendered, linked in the sitemap, listed in llms.txt, and still be
// unreachable: if no other page links to it, the only way in is to already know
// the URL. That is a page that exists for crawlers and not for people.
//
// WHY THIS EXISTS. The dossier redesign replaced the homepage's link list with
// presentation.links, and Writing was not among the four entries that survived.
// /blog and both posts kept building, kept their sitemap entries, kept their
// llms.txt lines and their Markdown twins — and became an island: the only links
// pointing at /blog came from the two posts, which you could only get to FROM
// /blog. Nothing outside the island pointed in. It shipped that way, and every
// gate stayed green, because each was measuring something else:
//
//   structure-audit   link checker — finds links that point at NOTHING.
//                     An orphan is the opposite: a page nothing points AT.
//   seo-gate          canonical/sitemap/robots consistency. A sitemap entry is
//                     not a link; a page listed there and linked from nowhere is
//                     perfectly consistent, and perfectly unreachable.
//   ai-readability    llms.txt links resolve — and llms.txt DID carry /blog.md,
//                     so the machine-readable surface was fine while the human
//                     one was broken. That is the whole failure in one line.
//
// WHAT IT MEASURES. Reachability from the site root, over the links a reader can
// actually click: breadth-first from "/" across every internal <a href> in the
// built HTML. Any built page the walk never arrives at is an error.
//
// This is deliberately about HTML pages only. The Markdown twins and llms.txt are
// a parallel surface with their own gate (md-parity, ai-readability); a page whose
// only inbound reference is machine-readable is exactly what this exists to catch.
//
//   node scripts/reachability-gate.mjs dist
//
// Pure + dependency-free: Node builtins only. Reads the built HTML, writes nothing.
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const dir = process.argv[2] ?? "dist";

// Never linked, by design — the platform serves it on a miss, so no page should
// point at it. Anything else that wants an exemption should have to argue for it
// here, in the open, rather than being quietly dropped from the walk.
const UNLINKED_BY_DESIGN = new Set(["/404"]);

async function htmlFiles(root, sub = "") {
  const out = [];
  for (const e of await readdir(join(root, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await htmlFiles(root, rel)));
    else if (e.name.endsWith(".html")) out.push(rel);
  }
  return out;
}

// dist/index.html → "/", dist/archive.html → "/archive",
// dist/blog/a-post.html → "/blog/a-post"  — the routes the Worker serves.
const routeOf = (rel) =>
  "/" + rel.replace(/\.html$/, "").replace(/(^|\/)index$/, "").replace(/^\//, "");

// href="/x" only: same-origin absolute paths, which is how this site links
// internally. Protocol-relative (//host) and external URLs are somebody else's
// pages; fragments and queries are the same page.
const INTERNAL_HREF = /href="(\/[^"#?][^"]*|\/)"/g;
const normalize = (href) => {
  const path = href.split("#")[0].split("?")[0].replace(/\/+$/, "");
  return path === "" ? "/" : path;
};

const files = (await htmlFiles(dir)).sort();
const pages = new Map(files.map((f) => [routeOf(f), f]));

if (!pages.has("/")) {
  console.error(`✗ reachability-gate: no ${dir}/index.html — nothing to walk from.`);
  process.exit(1);
}

// Breadth-first from the root, over links only.
const reached = new Set(["/"]);
const queue = ["/"];
const inbound = new Map();
while (queue.length) {
  const route = queue.shift();
  const html = await readFile(join(dir, pages.get(route)), "utf8");
  for (const [, href] of html.matchAll(INTERNAL_HREF)) {
    const target = normalize(href);
    if (!pages.has(target)) continue; // a link to a served artifact, not a page
    inbound.set(target, (inbound.get(target) ?? 0) + 1);
    if (!reached.has(target)) {
      reached.add(target);
      queue.push(target);
    }
  }
}

const orphans = [...pages.keys()]
  .filter((r) => !reached.has(r) && !UNLINKED_BY_DESIGN.has(r))
  .sort();

for (const route of [...pages.keys()].sort()) {
  const mark = reached.has(route) ? "✓" : UNLINKED_BY_DESIGN.has(route) ? "·" : "✗";
  const note = route === "/"
    ? "the root"
    : UNLINKED_BY_DESIGN.has(route) && !reached.has(route)
    ? "unlinked by design"
    : `${inbound.get(route) ?? 0} inbound link(s)`;
  console.log(`  ${mark} ${route.padEnd(38)} ${note}`);
}

if (orphans.length) {
  console.error(
    `\n✗ reachability-gate: ${orphans.length} page(s) ship with no path to them from ${
      pages.get("/") ? "/" : "the root"
    }:`,
  );
  for (const route of orphans) {
    console.error(`    ${route}  (${relative(".", join(dir, pages.get(route)))})`);
  }
  console.error(
    "\n  A sitemap entry is not a link and llms.txt is not navigation. Either link\n" +
      "  the page from one a reader can already reach, or stop building it.",
  );
  process.exit(1);
}

console.log(
  `\n✓ reachability-gate: all ${pages.size - UNLINKED_BY_DESIGN.size} linkable page(s) reachable from / by following links.`,
);
