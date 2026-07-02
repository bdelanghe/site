#!/usr/bin/env node
// Emit framework-agnostic token exports from the generated tokens.css (authoritative
// --bs-* layer). Each export BINDS the framework to the existing CSS variables, so
// the design system stays the single source — StyleX/VE/Panda just reference it.
//   node tokens/export.mjs   → writes tokens.flat.json, tokens.stylex.mjs, tokens.vars.css.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "tokens.css"), "utf8");

// --bs-foo-bar  →  { name:"foo-bar", var:"--bs-foo-bar", value, camel:"fooBar" }
const tokens = [];
for (const m of css.matchAll(/(--bs-[a-z0-9-]+):\s*([^;]+);/g)) {
  const cssVar = m[1], value = m[2].trim();
  const name = cssVar.replace(/^--bs-/, "");
  const camel = name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
  tokens.push({ name, var: cssVar, value, camel });
}
const ref = (t) => `var(${t.var})`;

// 1. universal manifest
writeFileSync(join(here, "tokens.flat.json"), JSON.stringify(tokens.map(({ camel, ...t }) => t), null, 2) + "\n");

// 2. StyleX — defineVars whose values reference the existing --bs-* vars
const stylex =
  `// AUTO-GENERATED from tokens.css by export.mjs. StyleX vars bound to the brand --bs-* layer.\n` +
  `import * as stylex from "@stylexjs/stylex";\n\n` +
  `export const tokens = stylex.defineVars({\n` +
  tokens.map((t) => `  ${t.camel}: "${ref(t)}",`).join("\n") +
  `\n});\n`;
writeFileSync(join(here, "tokens.stylex.mjs"), stylex);

// 3. Vanilla Extract — a global theme CONTRACT mapped to the existing --bs-* names
const ve =
  `// AUTO-GENERATED from tokens.css by export.mjs. VE contract bound to the brand --bs-* layer.\n` +
  `import { createGlobalThemeContract } from "@vanilla-extract/css";\n\n` +
  `export const vars = createGlobalThemeContract(\n  {\n` +
  tokens.map((t) => `    ${t.camel}: "${t.name}",`).join("\n") +
  `\n  },\n  (_value, path) => \`--bs-\${path}\`,\n);\n`;
writeFileSync(join(here, "tokens.vars.css.ts"), ve);

console.log(`✓ exported ${tokens.length} tokens → tokens.flat.json, tokens.stylex.mjs, tokens.vars.css.ts`);
