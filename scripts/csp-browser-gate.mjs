#!/usr/bin/env node
// Load every page in a real browser UNDER the policy and fail on any violation.
//
// csp-gate.mjs proves the policy covers the bytes. This proves the pages still WORK — the
// check build.mjs's old comment insisted on before a CSP could ship: "a CSP shipped without
// testing against the live edge is a broken page, so it is follow-up work with a real test."
// A hash-based policy that is one byte stale does not warn; it silently kills the script.
//
//   node scripts/csp-browser-gate.mjs                     # serve dist/, apply the built policy
//   node scripts/csp-browser-gate.mjs https://robertdelanghe.dev   # the SERVED policy, post-deploy
//
// In live mode the header comes from the edge, so this also catches a CDN that drops,
// rewrites, or doubles the policy — none of which the build can see.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const target = process.argv[2];
const live = /^https?:\/\//.test(target || "");
const dist = resolve(process.cwd(), process.env.DIST || "dist");
const ROUTES = ["/", "/resume", "/archive", "/blog", "/provenance", "/conformance", "/colophon", "/interests",
  "/blog/agent-authored-code-drift", "/blog/resume-pipeline-google-docs-incident"];
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain",
  ".md": "text/markdown", ".pdf": "application/pdf" };

let base = target, server;
// LIVE MODE MUST PROVE THE POLICY IS THERE.
//
// An earlier version of this gate only watched for securitypolicyviolation. Against an
// origin serving NO policy there are no violations, so it reported green on a site with no
// CSP at all — which is precisely what happened: the generator was wired into `npm run
// build` while the deploy pipeline runs its generators explicitly, the policy never
// shipped, and this job called it a success. Absence of a violation is not presence of a
// policy. So live mode fetches the header first and fails closed if it is missing, weak,
// or doubled.
if (live) {
  const res = await fetch(base + "/", { headers: { "cache-control": "no-cache" } });
  const served = res.headers.get("content-security-policy");
  // getAll() is not in undici's Headers; a repeated header arrives comma-joined, and a
  // policy legitimately contains no commas — so a comma here means the edge sent two.
  const all = served ? served.split(",").filter((p) => /(?:^|\s)(?:default|script|style)-src\s/.test(p)) : [];
  if (!served) {
    console.error(`✗ csp-browser-gate: ${base} serves NO Content-Security-Policy header.`);
    console.error("  The build may not have run scripts/gen-csp.mjs (the deploy pipeline lists its");
    console.error("  generators explicitly and does not use `npm run build`), or the edge dropped it.");
    process.exit(1);
  }
  if (all.length > 1) {
    console.error(`✗ csp-browser-gate: ${all.length} Content-Security-Policy policies in the response — browsers enforce the INTERSECTION.`);
    process.exit(1);
  }
  const { UNSAFE } = await import("./csp-lib.mjs");
  for (const u of UNSAFE) if (served.includes(u)) { console.error(`✗ csp-browser-gate: served policy contains ${u}`); process.exit(1); }
  if (!/(?:^|;)\s*default-src\s+'none'/.test(served)) { console.error("✗ csp-browser-gate: served policy has no default-src 'none'"); process.exit(1); }
  const hashes = (served.match(/'sha256-[A-Za-z0-9+/=]+'/g) || []).length;
  if (!hashes) { console.error("✗ csp-browser-gate: served policy carries no hashes — it cannot be covering the inline blocks"); process.exit(1); }
  console.log(`· served policy: ${hashes} hash(es), no unsafe-*, default-src 'none' — ${served.length} bytes`);
}
if (!live) {
  const csp = (await readFile(join(dist, "_headers"), "utf8")).match(/Content-Security-Policy: (.+)/)?.[1]?.trim();
  if (!csp) { console.error("✗ csp-browser-gate: no policy in dist/_headers — run scripts/gen-csp.mjs"); process.exit(1); }
  server = createServer(async (req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let file = join(dist, p), body;
    try { body = await readFile(file); } catch {
      try { body = await readFile(file + ".html"); file += ".html"; } catch {
        res.writeHead(404, { "content-type": "text/html", "content-security-policy": csp });
        return res.end(await readFile(join(dist, "404.html")));
      }
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "content-security-policy": csp });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
}
console.log(`csp-browser-gate: ${live ? "SERVED policy" : "built policy over dist/"} · ${base} · ${ROUTES.length + 1} route(s)`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
let problems = 0;
for (const route of [...ROUTES, "/this-path-should-never-exist-12345"]) {
  const page = await browser.newPage();
  const errs = [];
  await page.addInitScript(() => {
    window.__cspv = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__cspv.push(`${e.violatedDirective} blocked ${e.blockedURI || "inline"} (${String(e.sourceFile || "").split("/").pop()}:${e.lineNumber})`));
  });
  page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(base + route, { waitUntil: "networkidle" }).catch((e) => errs.push(`navigation: ${e.message.split("\n")[0]}`));

  const cspv = await page.evaluate(() => window.__cspv || []);
  const state = await page.evaluate(() => ({
    header: !!document.querySelector("h1, .intro"),
    pending: document.querySelectorAll("[data-mail]").length,
    mailto: document.querySelectorAll('a[href^="mailto:"]').length,
  }));
  // An inline script the policy blocks leaves the obfuscated span in place, so this is the
  // functional counterpart to "no violation was reported".
  if (state.pending) cspv.push(`${state.pending} unresolved [data-mail] — the de-obfuscator did not run`);
  if (!state.header && !route.includes("should-never-exist")) cspv.push("page rendered no heading — it may not have loaded");

  // Two exclusions, both narrow: a cert failure is the sandbox's TLS proxy rather than the
  // site, and the deliberate-404 route logs its OWN 404 status (a 404 on any other route,
  // or on a subresource, still counts).
  const ignorable = (e) => e.includes("ERR_CERT_AUTHORITY_INVALID")
    || (route.includes("should-never-exist") && /status of 404/.test(e));
  const real = [...cspv, ...errs.filter((e) => !ignorable(e))];
  if (real.length) { problems += real.length; console.log(`  ✗ ${route}`); real.forEach((v) => console.log(`      ${v}`)); }
  else console.log(`  ✓ ${route}${state.mailto ? `  (mailto resolved)` : ""}`);
  await page.close();
}
await browser.close();
server?.close();

if (problems) { console.error(`\n✗ csp-browser-gate: ${problems} problem(s) — the policy breaks the page`); process.exit(1); }
console.log(`\n✓ csp-browser-gate: every route loads clean under the policy, no violations.`);
