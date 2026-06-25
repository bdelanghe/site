#!/usr/bin/env node
// Local dev server with hot reload — the interactive counterpart to `node build.mjs`.
//
//   npm run dev          # serve http://localhost:8080, rebuild + live-reload on change
//   PORT=3000 npm run dev
//
// What it does: run build.mjs once, serve dist/ over HTTP, watch the build inputs, and
// on every successful rebuild push a reload event to connected browsers (Server-Sent
// Events). Dependency-free — Node built-ins only — and NOT part of the production build:
// the reload snippet is injected into the served HTTP response, never written to disk, so
// dist/ stays byte-identical to what `nix build` / Cloudflare produce. It need not match
// the hermetic build 1:1; it's for fast local iteration.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const PORT = Number(process.env.PORT) || 8080;

// ---- build (as a child process) ------------------------------------------------
// build.mjs uses top-level await and calls process.exit(1) on a validation failure,
// so we can't import it (one bad edit would kill the dev server, and ESM caches the
// module). Spawning isolates failures: a broken edit prints its error and leaves the
// last good dist/ in place; the browser stays on the last good page.
let building = false;
let queued = false;
function runBuild() {
  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const child = spawn(process.execPath, [join(root, "build.mjs")], { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (code === 0) console.log(`\x1b[32m✓\x1b[0m rebuilt in ${ms.toFixed(0)}ms`);
      else console.error(`\x1b[31m✗\x1b[0m build failed (exit ${code}) — keeping last good dist/`);
      resolve(code);
    });
    child.on("error", (err) => { console.error(`✗ could not spawn build: ${err.message}`); resolve(1); });
  });
}

// Serialize builds; coalesce a burst of edits into one trailing rebuild.
async function rebuild() {
  if (building) { queued = true; return; }
  building = true;
  const code = await runBuild();
  building = false;
  if (code === 0) notifyReload();
  if (queued) { queued = false; rebuild(); }
}

// ---- live-reload clients (SSE) -------------------------------------------------
const clients = new Set();
function notifyReload() {
  for (const res of clients) { try { res.write("data: reload\n\n"); } catch { /* dropped */ } }
}
const RELOAD_SNIPPET = `<script>(()=>{const s=new EventSource("/__dev/reload");s.onmessage=()=>location.reload();})();</script>`;

// ---- static serving ------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".pdf": "application/pdf",
};
const isFile = async (p) => { try { return (await stat(p)).isFile(); } catch { return false; } };

// Resolve a request path to a file in dist/, mirroring the extensionless convention
// the site is served under (Cloudflare): `/` → index.html; a path with no extension →
// `<p>.html` then `<p>/index.html`; otherwise the literal file.
async function resolveFile(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  // Contain to dist/ — reject path traversal.
  const safe = normalize(p).replace(/^(\.\.(\/|\\|$))+/, "");
  if (safe === "/" || safe === "" || safe === ".") return join(dist, "index.html");
  const abs = join(dist, safe);
  if (extname(abs)) return (await isFile(abs)) ? abs : null;
  if (await isFile(abs + ".html")) return abs + ".html";
  if (await isFile(join(abs, "index.html"))) return join(abs, "index.html");
  return null;
}

const server = createServer(async (req, res) => {
  if (req.url === "/__dev/reload") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.write("retry: 500\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  let file = await resolveFile(req.url);
  let status = 200;
  if (!file) { status = 404; file = join(dist, "404.html"); if (!(await isFile(file))) { res.writeHead(404).end("Not found"); return; } }
  const type = MIME[extname(file)] || "application/octet-stream";
  // Inject the reload client into HTML responses only — in the response bytes, never on disk.
  if (type.startsWith("text/html")) {
    let body = await readFile(file, "utf8");
    body = body.includes("</body>") ? body.replace("</body>", `${RELOAD_SNIPPET}</body>`) : body + RELOAD_SNIPPET;
    res.writeHead(status, { "Content-Type": type });
    res.end(body);
    return;
  }
  res.writeHead(status, { "Content-Type": type });
  res.end(await readFile(file));
});

// ---- watch + debounce ----------------------------------------------------------
// Never watch dist/ — build.mjs does `rm -rf dist` then rewrites it, so watching it
// would loop forever. The watched dirs are siblings of dist/, and the root watch is
// non-recursive; we also ignore dist/node_modules/.git defensively.
const IGNORE = /^(dist|node_modules|\.git)(\/|\\|$)/;
let timer = null;
const schedule = (label) => {
  clearTimeout(timer);
  timer = setTimeout(() => { console.log(`↻ ${label} changed — rebuilding`); rebuild(); }, 150);
};
function watchDir(dir, recursive) {
  try {
    watch(dir, { recursive }, (_evt, filename) => {
      if (filename && IGNORE.test(String(filename))) return;
      schedule(filename ? join(dir.replace(root + "/", ""), String(filename)) : dir);
    });
  } catch (err) {
    if (recursive && err?.code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM") {
      console.warn(`recursive watch unavailable for ${dir}; falling back to non-recursive`);
      watchDir(dir, false);
    } else if (err?.code !== "ENOENT") {
      console.warn(`watch skipped ${dir}: ${err?.message ?? err}`);
    }
  }
}

// ---- start ---------------------------------------------------------------------
await rebuild(); // initial build (server still starts even if it failed)
for (const d of ["data", "contract", "posts", "brand", "assets"]) watchDir(join(root, d), true);
watchDir(root, false); // top-level *.mjs, styles.css, 404.html (non-recursive avoids dist/)
server.listen(PORT, () => {
  console.log(`\n  dev server  →  http://localhost:${PORT}`);
  console.log(`  watching    →  data/ contract/ posts/ brand/ assets/ + root *.mjs/styles.css/404.html`);
  console.log(`  live reload →  on (SSE); rebuilds on change, reloads the browser on success\n`);
});
