// Custom Style Dictionary format: a TYPED, grouped TS module.
//
// Emits `tokens/tokens.ts`:
//   export const tokens = { <category>: { <name>: <resolved value>, … }, … } as const;
//   export type Tokens        = typeof tokens;          // the whole tree
//   export type TokenCategory = keyof Tokens;           // "color" | "font" | …
//   export type TokenName     = "color.forest" | …      // every "<category>.<name>"
//
// Grouped by the first path segment (the DTCG category), values fully resolved
// by SD (aliases dereferenced, exactly like the js/flat-json projections). `as
// const` gives literal types → `tokens.color.forest` autocompletes to its hex.
//
// Pure + deterministic: ordering follows token source order, so byte output is
// reproducible and drift-checkable (see tools/build-tokens-ts.mjs --check).

const HEADER = "// AUTO-GENERATED from tokens/tokens.json by Style Dictionary (npm run build:sd).\n// Do not edit by hand — drift-checked by `npm run tokens:ts:check`.\n";

const isIdent = (k) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k);
const key = (k) => (isIdent(k) ? k : JSON.stringify(k));
const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();

// Resolved value → a TS literal. JSON is a valid TS object/array/scalar literal;
// composite (typography) values stringify to a compact inline object.
const literal = (v) => JSON.stringify(v);

export const name = "typescript/bs-tokens";

/** @param {{ dictionary: { allTokens: Array<any> } }} args */
export function format({ dictionary }) {
  // Preserve source order; group by category (path[0]).
  const groups = new Map();
  for (const t of dictionary.allTokens) {
    const [cat, ...rest] = t.path;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push({
      name: rest.join("-"),
      value: t.$value ?? t.value,
      desc: t.$description ?? t.comment,
    });
  }

  const L = [];
  L.push(HEADER.trimEnd());
  L.push("");
  L.push("export const tokens = {");
  for (const [cat, members] of groups) {
    L.push(`  ${key(cat)}: {`);
    for (const m of members) {
      const comment = m.desc ? ` // ${oneLine(m.desc)}` : "";
      L.push(`    ${key(m.name)}: ${literal(m.value)},${comment}`);
    }
    L.push("  },");
  }
  L.push("} as const;");
  L.push("");
  L.push("/** The full, resolved token tree. */");
  L.push("export type Tokens = typeof tokens;");
  L.push("");
  L.push("/** Top-level token categories: " + [...groups.keys()].map((c) => `\`${c}\``).join(" | ") + ". */");
  L.push("export type TokenCategory = keyof Tokens;");
  L.push("");
  L.push("/** Every fully-qualified token name, e.g. `color.forest`. */");
  L.push("export type TokenName = {");
  L.push("  [C in TokenCategory]: `${C}.${Extract<keyof Tokens[C], string>}`;");
  L.push("}[TokenCategory];");
  return L.join("\n") + "\n";
}

export default { name, format };
