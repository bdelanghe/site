#!/usr/bin/env node
// ax-name gate — what a screen reader is actually handed.
//
// NOT a screen reader. This reads Chrome's computed ACCESSIBILITY TREE over CDP —
// post-CSS, post-ARIA, with real accessible names — which is the data NVDA, JAWS and
// VoiceOver consume. It is a strictly better vantage point than the static DOM, and it
// is still NOT AT-user testing: it cannot tell you whether the announcement makes
// sense, only what the announcement will be.
//
// WHY IT EXISTS. Every outbound link on this site announced its decorative arrow —
// "GitHub northeast arrow", "prx northeast arrow" — 171 names across 10 pages. The
// glyph comes from `a[href^="http"]::after { content: "↗" }`, and GENERATED CONTENT IS
// PART OF THE ACCESSIBLE NAME. No existing gate could see it: axe was satisfied (the
// link has a name), and lone parses the static DOM with linkedom, where CSS-generated
// content does not exist at all. It took reading the computed tree.
//
// THE RULE. An accessible name must come from the DOCUMENT, not the stylesheet. So for
// any named element that does NOT declare its own name (no aria-label, aria-labelledby
// or title), the computed name must be contained in the element's own DOM text. A name
// carrying characters the document does not have came from CSS, and a reader of the
// markup cannot see it — which is exactly how 171 of them shipped.
//
// Elements WITH aria-label/aria-labelledby/title are exempt: the author stated the name
// deliberately, and diverging from the visible text is the point of those attributes.
//
// The fix, when this fires, is the CSS alternative-text syntax — `content: "↗" / ""` —
// which gives generated content an empty alternative. A browser without support keeps
// the old behaviour, so the degradation is the status quo rather than a break.
//
//   node scripts/ax-name-gate.mjs            # builds against dist/, serves it locally
//
// Requires Chromium (already a devDependency via playwright, used by axe-gate).
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";

const dir = process.argv[2] ?? "dist";
const PORT = 8899;
const TYPES = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png",
  ".ico": "image/x-icon", ".json": "application/json", ".xml": "application/xml",
  ".txt": "text/plain", ".md": "text/markdown",
};
// Roles whose name is spoken as the element's identity. A paragraph's text is read as
// content, not as a name, so a stray glyph there is a different (visual) question.
const NAMED_ROLES = new Set([
  "link", "button", "heading", "image", "img", "checkbox", "radio", "textbox",
  "combobox", "menuitem", "tab", "switch", "listitem",
]);

const srv = createServer(async (req, res) => {
  let u = decodeURIComponent(req.url.split("?")[0]);
  if (u === "/") u = "/index.html";
  for (const t of [u, u + ".html", u + "/index.html"]) {
    try {
      const b = await readFile(join(dir, t));
      res.setHeader("content-type", TYPES[extname(t)] ?? "application/octet-stream");
      return res.end(b);
    } catch { /* next */ }
  }
  res.statusCode = 404;
  res.end("404");
}).listen(PORT);

async function routes(root, sub = "") {
  const out = [];
  for (const e of await readdir(join(root, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await routes(root, rel)));
    else if (e.name.endsWith(".html")) out.push("/" + rel.replace(/\.html$/, "").replace(/^index$/, ""));
  }
  return out;
}

// Case-folded, because `text-transform: uppercase` is a VISUAL transform that Chrome
// reflects in the accessible name: the markup says "Currently" and the tree says
// "CURRENTLY". Comparing case-sensitively flagged 23 of those as CSS-injected content
// on the first run — a false positive in this gate, not a defect in the site.
const squash = (s) => (s ?? "").replace(/\s+/g, "").toLowerCase().trim();
const browser = await chromium.launch();
const page = await browser.newPage();
let failed = 0, checked = 0;
const report = [];

for (const route of (await routes(dir)).sort()) {
  await page.goto(`http://127.0.0.1:${PORT}${route}`, { waitUntil: "networkidle" });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Accessibility.enable");
  const { nodes } = await cdp.send("Accessibility.getFullAXTree");

  const bad = [];
  for (const n of nodes) {
    if (n.ignored || n.backendDOMNodeId === undefined) continue;
    const role = n.role?.value ?? "";
    const name = (n.name?.value ?? "").replace(/\s+/g, " ").trim();
    if (!NAMED_ROLES.has(role) || !name) continue;
    checked++;
    // Read the element's own markup text + whether it declares a name.
    let info;
    try {
      const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: n.backendDOMNodeId });
      const r = await cdp.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          return {
            text: this.textContent || "",
            declared: !!(this.getAttribute && (this.getAttribute("aria-label") ||
              this.getAttribute("aria-labelledby") || this.getAttribute("title") ||
              this.getAttribute("alt"))),
          };
        }`,
      });
      info = r.result.value;
    } catch { continue; }
    if (!info || info.declared) continue;                 // author stated the name on purpose
    if (squash(info.text).includes(squash(name))) continue; // name comes from the document
    const extra = [...squash(name)].filter((ch) => !squash(info.text).includes(ch)).join("");
    bad.push(`${role} "${name.slice(0, 46)}"   ← ${extra ? `"${extra}" is not in the markup` : "name diverges from the document"}`);
  }

  if (bad.length) { failed++; report.push([route, bad]); }
  else console.log(`  ✓ ${route.padEnd(38)} every announced name comes from the document`);
}

for (const [route, bad] of report) {
  console.error(`\n  ✗ ${route} — ${bad.length} name(s) carrying content the markup does not have:`);
  for (const b of bad.slice(0, 10)) console.error(`      ${b}`);
  if (bad.length > 10) console.error(`      (+${bad.length - 10} more)`);
}

await browser.close();
srv.close();

if (failed) {
  console.error(
    `\n✗ ax-name-gate: ${failed} page(s) announce names built from CSS.\n` +
      "\n  Generated content is part of the accessible name. If the glyph is decorative,\n" +
      '  give it an empty alternative — `content: "↗" / ""` — so it paints without being\n' +
      "  spoken. If it carries meaning, put it in the markup where a reader can see it.\n" +
      "\n  Evidence type: computed accessibility tree (Chrome/CDP) — NOT AT-user testing.",
  );
  process.exit(1);
}
console.log(
  `\n✓ ax-name-gate: ${checked} announced name(s) across ${(await routes(dir)).length} page(s) — every one traceable to the document.\n` +
    "  Evidence type: computed accessibility tree (Chrome/CDP) — NOT AT-user testing.",
);
