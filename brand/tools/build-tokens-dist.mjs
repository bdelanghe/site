// Assemble a deployable, spec-conformant token bundle into dist/tokens-site/.
//
//   node tools/build-tokens-dist.mjs           # assemble the bundle
//   node tools/build-tokens-dist.mjs --check   # verify tokens.json conforms + every
//                                               # declared artifact is present (CI gate)
//
// The bundle is a CONTRACT, not a dump: manifest.json (validated against
// tokens/manifest.schema.json) declares every format projection with its IANA
// media type and SHA-256, so a consumer can fetch a stable URL, verify the
// bytes, and pick a format without scraping the layout. Canonical source is the
// DTCG tokens.json; the rest are derived projections.
//
// Dependency-free (node: builtins only), like build-tokens.mjs — the bundle can
// be assembled in any hermetic environment. Style Dictionary outputs (scss/js/
// flat-json/swift/xml) are included when present in dist/ (CI runs `build:sd`
// first); the always-present core is tokens.json + tokens.css.

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outDir = join(root, "dist", "tokens-site");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// The published contract. `required` artifacts must exist; optional ones are
// included when a prior `build:sd` produced them. Order is the manifest order.
const ARTIFACTS = [
  { out: "tokens.json", src: "tokens/tokens.json", required: true, mediaType: "application/design-tokens+json", format: "dtcg", description: "Canonical W3C DTCG source." },
  { out: "tokens.css", src: "tokens/tokens.css", required: true, mediaType: "text/css", format: "css-variables", description: "CSS custom properties + .bs-text-* composite classes (the curated web artifact)." },
  { out: "tokens.ts", src: "tokens/tokens.ts", required: false, mediaType: "text/typescript", format: "typescript", description: "Typed TS module — `export const tokens = {…} as const` (the JSR default export)." },
  { out: "tokens.scss", src: "dist/tokens.scss", required: false, mediaType: "text/x-scss", format: "scss", description: "SCSS variables." },
  { out: "tokens.js", src: "dist/tokens.js", required: false, mediaType: "text/javascript", format: "js", description: "ES6 token constants." },
  { out: "tokens.flat.json", src: "dist/tokens.flat.json", required: false, mediaType: "application/json", format: "json-flat", description: "Flat map — convenient for Tokens Studio import." },
  { out: "Tokens.swift", src: "dist/Tokens.swift", required: false, mediaType: "text/x-swift", format: "swift", description: "iOS Swift constants (BSTokens)." },
  { out: "tokens.xml", src: "dist/tokens.xml", required: false, mediaType: "application/xml", format: "android-xml", description: "Android resources." },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// Pragmatic DTCG conformance: every leaf carrying $value must resolve a $type
// (on itself or an ancestor group), references use {dot.path} syntax, and no
// stray non-`$` reserved keys leak. Returns token count; throws on violation.
function assertDtcg(tokens) {
  let count = 0;
  const walk = (node, path, inheritedType) => {
    if (node === null || typeof node !== "object") return;
    const type = node.$type ?? inheritedType;
    if (Object.prototype.hasOwnProperty.call(node, "$value")) {
      count++;
      if (!type) throw new Error(`DTCG: token "${path}" has $value but no resolvable $type`);
      const v = node.$value;
      if (typeof v === "string" && v.startsWith("{") && !/^\{[a-zA-Z0-9_.-]+\}$/.test(v)) {
        throw new Error(`DTCG: token "${path}" has malformed reference ${v}`);
      }
      return;
    }
    for (const [k, child] of Object.entries(node)) {
      if (k.startsWith("$")) continue;
      walk(child, path ? `${path}.${k}` : k, type);
    }
  };
  walk(tokens, "", undefined);
  if (count === 0) throw new Error("DTCG: no tokens found");
  return count;
}

const tokens = JSON.parse(readFileSync(join(root, "tokens/tokens.json"), "utf8"));
const tokenCount = assertDtcg(tokens);

const check = process.argv.includes("--check");
const missing = [];
const resolved = [];
for (const a of ARTIFACTS) {
  const abs = join(root, a.src);
  if (!existsSync(abs)) {
    if (a.required) missing.push(a.src);
    continue;
  }
  resolved.push({ ...a, abs });
}
if (missing.length) {
  console.error(`✗ missing required artifact(s): ${missing.join(", ")}`);
  process.exit(1);
}

const artifacts = resolved.map(({ out, abs, mediaType, format, description }) => {
  const buf = readFileSync(abs);
  return { path: out, mediaType, format, bytes: buf.length, sha256: sha256(buf), description };
});

const manifest = {
  $schema: "https://bounded.tools/schema/tokens-manifest.json",
  name: pkg.name,
  version: pkg.version,
  ...(process.env.GITHUB_SHA ? { commit: process.env.GITHUB_SHA } : {}),
  spec: { format: "DTCG", ref: "https://tr.designtokens.org/format/", source: "tokens.json" },
  artifacts,
};

if (check) {
  // Validate the manifest we WOULD write against the published schema contract,
  // then confirm conformance. No bytes are written in --check.
  validateManifest(manifest);
  console.log(`✓ tokens.json conforms to DTCG (${tokenCount} tokens); bundle contract valid (${artifacts.length} artifacts)`);
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
for (const { out, abs } of resolved) copyFileSync(abs, join(outDir, out));
validateManifest(manifest);
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`✓ wrote dist/tokens-site/ — ${artifacts.length} artifacts, ${tokenCount} tokens\n  ` +
  artifacts.map((a) => `${a.path} (${a.mediaType})`).join("\n  "));

// Minimal, dependency-free structural validation against manifest.schema.json:
// enforce the required-field + sha256/version shape the schema declares. The
// published JSON Schema remains the authority external consumers validate with.
function validateManifest(m) {
  const fail = (msg) => { console.error(`✗ manifest contract violation: ${msg}`); process.exit(1); };
  for (const k of ["name", "version", "spec", "artifacts"]) if (!(k in m)) fail(`missing ${k}`);
  if (!/^[0-9]+\.[0-9]+\.[0-9]+/.test(m.version)) fail(`bad version ${m.version}`);
  if (m.spec.format !== "DTCG" || !m.spec.source) fail("bad spec block");
  if (!Array.isArray(m.artifacts) || m.artifacts.length === 0) fail("no artifacts");
  for (const a of m.artifacts) {
    for (const k of ["path", "mediaType", "format", "bytes", "sha256"]) if (!(k in a)) fail(`artifact missing ${k}`);
    if (!/^[0-9a-f]{64}$/.test(a.sha256)) fail(`bad sha256 for ${a.path}`);
    if (!Number.isInteger(a.bytes) || a.bytes < 0) fail(`bad bytes for ${a.path}`);
  }
}
