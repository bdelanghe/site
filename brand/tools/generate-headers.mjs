#!/usr/bin/env node
// Generate dark + light header SVGs for the bdelanghe/bdelanghe GitHub profile
// from tokens.json (design tokens) and content/strings.json (brand copy).
// The only authoritative source of both color values and tagline copy.
//
//   node tools/generate-headers.mjs              # write to dist/github-headers/
//   node tools/generate-headers.mjs --out <dir>  # write to <dir>
//   node tools/generate-headers.mjs --check <dir># exit 1 if SVGs in <dir> are stale (CI)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const tokens = JSON.parse(readFileSync(join(root, "tokens/tokens.json"), "utf8"));
const strings = JSON.parse(readFileSync(join(root, "content/strings.json"), "utf8"));

// Resolve {tier.key} references — same logic as build-tokens.mjs.
const resolveRef = (s) =>
  String(s).replace(/\{([^}]+)\}/g, (_, p) => {
    let n = tokens;
    for (const k of p.split(".")) n = n[k];
    return Array.isArray(n.$value) ? n.$value[0] : n.$value;
  });

const prim = (k) => resolveRef(tokens.primitive[k].$value);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// Pure: generate one SVG string for `theme` ("dark" | "light").
// All values derived from tokens + strings — no hardcoded colors or copy.
export const generateHeaderSvg = (theme, copy) => {
  const dark = theme === "dark";
  const bg       = prim(dark ? "ink-900" : "paper");
  const nameCol  = prim(dark ? "paper"   : "ink-900");
  const subCol   = prim(dark ? "green-200" : "ink-600");
  const capCol   = prim(dark ? "green-200" : "ink-500");
  const g1       = prim("green-700");
  const g2       = prim("amber-600");
  const { tagline, keywords } = copy;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="280" viewBox="0 0 1280 280" role="img" aria-label="Robert DeLanghe — ${tagline}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${g1}"/>
      <stop offset="1" stop-color="${g2}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="280" fill="${bg}"/>
  <rect x="0" y="0" width="8" height="280" fill="url(#accent)"/>
  <text x="72" y="118" font-family="${FONT}" font-size="58" font-weight="700" fill="${nameCol}" letter-spacing="-1">Robert DeLanghe</text>
  <rect x="74" y="140" width="96" height="4" rx="2" fill="url(#accent)"/>
  <text x="72" y="186" font-family="${FONT}" font-size="25" font-weight="600" fill="${subCol}">${tagline}</text>
  <text x="72" y="222" font-family="${FONT}" font-size="15" font-weight="500" fill="${capCol}" letter-spacing="2.5">${keywords}</text>
  <g transform="translate(1078,72)" stroke="url(#accent)" stroke-width="3" fill="none">
    <rect x="0" y="0" width="132" height="140" rx="10"/>
    <rect x="41" y="44" width="50" height="96" rx="6"/>
    <circle cx="80" cy="92" r="4.5" fill="${g2}" stroke="none"/>
  </g>
</svg>`;
};

// ---- IO -----------------------------------------------------------------------

const argVal = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const check  = process.argv.includes("--check");
const outArg = argVal("--out") ?? argVal("--check");
const outDir = outArg ? outArg : join(root, "dist/github-headers");

const copy = {
  tagline:  strings.tagline.$value,
  keywords: strings.keywords?.$value ?? "CAPABILITY SECURITY · AGENT INFRASTRUCTURE · AI · DEVELOPER TOOLS",
};

const files = {
  "header-dark.svg":  generateHeaderSvg("dark",  copy),
  "header-light.svg": generateHeaderSvg("light", copy),
};

if (check) {
  let stale = false;
  for (const [name, expected] of Object.entries(files)) {
    let current = "";
    try { current = readFileSync(join(outDir, name), "utf8"); } catch {}
    if (current !== expected) {
      console.error(`✗ ${name} in ${outDir} is stale. Run: node tools/generate-headers.mjs --out ${outDir}`);
      stale = true;
    }
  }
  if (!stale) console.log(`✓ github headers up to date in ${outDir}`);
  process.exit(stale ? 1 : 0);
} else {
  mkdirSync(outDir, { recursive: true });
  for (const [name, svg] of Object.entries(files)) {
    writeFileSync(join(outDir, name), svg);
    console.log(`✓ wrote ${join(outDir, name)}`);
  }
}
