#!/usr/bin/env node
// Render resume/resume.html → resume/resume.pdf with headless Chrome.
// Zero npm deps — it drives a Chrome/Chromium binary already on the machine.
//
// `--no-pdf-header-footer` is the whole point: it strips the date / URL /
// "Page X of Y" chrome the browser otherwise stamps on every printed page —
// the exact junk the old export carried. The page box (Letter, margins,
// break rules) comes from the @page + @media print blocks in resume.css.
//
//   node tools/render-resume.mjs              → resume/resume.pdf
//   CHROME_BIN=/path/to/chrome node tools/render-resume.mjs
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const input = join(root, "resume", "resume.html");
const output = join(root, "resume", "resume.pdf");

const candidates = [
  process.env.CHROME_BIN,
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

function resolveChrome() {
  for (const c of candidates) {
    if (c.includes("/")) { if (existsSync(c)) return c; continue; }
    const which = spawnSync("command", ["-v", c], { shell: true, encoding: "utf8" });
    if (which.status === 0 && which.stdout.trim()) return which.stdout.trim();
  }
  return null;
}

const chrome = resolveChrome();
if (!chrome) {
  console.error("✗ no Chrome/Chromium found. Set CHROME_BIN, or install Chrome.\n" +
    "  Tried: " + candidates.join(", "));
  process.exit(1);
}

const args = [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-pdf-header-footer",       // newer Chrome
  "--print-to-pdf-no-header",     // older Chrome (ignored if unknown)
  "--virtual-time-budget=4000",   // let @font-face swap + layout settle
  "--run-all-compositor-stages-before-draw",
  `--print-to-pdf=${output}`,
  pathToFileURL(input).href,
];

const r = spawnSync(chrome, args, { encoding: "utf8" });
if (r.status !== 0 || !existsSync(output)) {
  console.error(`✗ render failed (chrome exit ${r.status})\n${r.stderr || ""}`);
  process.exit(1);
}
console.log(`✓ rendered resume/resume.pdf via ${chrome}`);
