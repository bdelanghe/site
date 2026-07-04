#!/usr/bin/env node
// banner.mjs — generate the profile banner SVGs from tokens. One source of truth:
//   strings  ← data/profile.json   (content tokens: name + banner.tagline + banner.stack)
//   colors   ← brand/tokens/tokens.json (design tokens: accent/ink/paper/status-warning/…)
// Pure: a deterministic function of those two files. No network. Mirrors build.mjs.
//
// Emits <out>/header-dark.svg and <out>/header-light.svg (consumed by the profile
// README's theme-aware <picture>). Fonts stay a system stack — GitHub-embedded SVGs
// can't load the brand's self-hosted woff2, so type is the one thing not tokenised.
//
// Usage: node banner.mjs [--profile <path>] [--tokens <path>] [--out <dir>]
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const profilePath = resolve(arg("--profile", join(here, "data", "profile.json")));
// banner copy (tagline/stack) is render-context — it lives in presentation.json,
// which decorates the canonical profile (name lives there). Merge the two like build.mjs.
const presentationPath = resolve(arg("--presentation", join(here, "data", "presentation.json")));
const tokensPath = resolve(arg("--tokens", join(here, "node_modules", "@bdelanghe", "brand", "tokens", "tokens.json")));
const out = resolve(arg("--out", join(here, "dist")));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const canonical = JSON.parse(await readFile(profilePath, "utf8"));
const presentation = JSON.parse(await readFile(presentationPath, "utf8"));
const profile = { ...canonical, ...presentation };
const tokens = JSON.parse(await readFile(tokensPath, "utf8"));

// Resolve a design-token $value, following {tier.key} aliases through ANY tier
// (the brand tokens alias color → primitive → hex, e.g. {color.accent} →
// {primitive.clay-600} → "#943D2A"). Recurses until a literal value remains.
const resolveRef = (v) => {
  const m = /^\{([\w-]+)\.([\w-]+)\}$/.exec(String(v));
  if (!m) return v;
  const node = tokens[m[1]]?.[m[2]];
  if (!node) throw new Error(`missing token: ${m[1]}.${m[2]}`);
  return resolveRef(node.$value);
};
const color = (name) => {
  const t = tokens.color?.[name];
  if (!t) throw new Error(`missing color token: color.${name}`);
  return resolveRef(t.$value);
};
const C = {
  accent: color("accent"), accentStrong: color("accent-strong"), accentSoft: color("accent-soft"),
  paper: color("paper"), ink: color("ink"), inkSoft: color("ink-soft"), inkMono: color("ink-mono"),
  onAccent: color("on-accent"), statusWarning: color("status-warning"),
};

// Content tokens (with safe fallbacks so a missing banner block still renders).
// Canonical is JSON Resume: name/label live under basics; skills are grouped.
const title = profile.basics?.name ?? "";
const tagline = profile.banner?.tagline ?? profile.basics?.label ?? "";
const skillFallback = (profile.skills ?? []).flatMap((g) => g.keywords ?? [g.name]);
const stack = (profile.banner?.stack ?? skillFallback).join(" · ").toUpperCase();

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// theme: { bg, title, tagline, stack } — all token-sourced; the gradient is accent→status-warning.
const svg = (t) => `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="280" viewBox="0 0 1280 280" role="img" aria-label="${esc(title)} — ${esc(tagline)}">
  <defs>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.accent}"/>
      <stop offset="1" stop-color="${C.statusWarning}"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="280" fill="${t.bg}"/>
  <rect x="0" y="0" width="8" height="280" fill="url(#accent)"/>
  <text x="72" y="118" font-family="${FONT}" font-size="58" font-weight="700" fill="${t.title}" letter-spacing="-1">${esc(title)}</text>
  <rect x="74" y="140" width="96" height="4" rx="2" fill="url(#accent)"/>
  <text x="72" y="186" font-family="${FONT}" font-size="25" font-weight="600" fill="${t.tagline}">${esc(tagline)}</text>
  <text x="72" y="222" font-family="${FONT}" font-size="15" font-weight="500" fill="${t.stack}" letter-spacing="2.5">${esc(stack)}</text>
  <g transform="translate(1078,72)" stroke="url(#accent)" stroke-width="3" fill="none">
    <rect x="0" y="0" width="132" height="140" rx="10"/>
    <rect x="41" y="44" width="50" height="96" rx="6"/>
    <circle cx="80" cy="92" r="4.5" fill="${C.statusWarning}" stroke="none"/>
  </g>
</svg>
`;

const dark = svg({ bg: C.ink, title: C.paper, tagline: C.accentSoft, stack: C.accentSoft });
const light = svg({ bg: C.paper, title: C.ink, tagline: C.inkSoft, stack: C.inkMono });

await mkdir(out, { recursive: true });
await writeFile(join(out, "header-dark.svg"), dark);
await writeFile(join(out, "header-light.svg"), light);
console.log(`✓ banner: header-dark.svg + header-light.svg → ${out}`);
console.log(`  title="${title}" · tagline="${tagline}" · stack=${profile.banner?.stack?.length ?? 0} items`);
