#!/usr/bin/env node
// css-token-purity — the deterministic build gate that keeps color in the design
// system. The visual counterpart to string-audit (see docs/css-token-purity.md).
//
// Three checks over styles.css, all decidable / order-free (same input → same verdict):
//   1. color-purity   — no literal color in any notation (hex, rgb()/hsl()/oklch()/…,
//                       named colors). Every color must be a var(--bs-color-*).
//   2. token-membership — every var(--bs-*) it references is a real token the brand
//                       defines. Catches typos / retired tokens.
//   3. surface-as-border — no page/card SURFACE token in a border, outline or rule
//                       color position. See below.
//
// WHY CHECK 3 EXISTS. The brand's palette contract says hairlines must clear 3:1 and
// grants no decorative exemptions. This stylesheet upheld that on paper while ruling
// its record rows with --bs-color-card-alt, a SURFACE token at 1.13:1 on white — a
// fill doing a border's job. It rendered, and every gate stayed green, because the
// palette gate checks DECLARED PAIRINGS and card-alt-as-border was not one: the policy
// was satisfied while the design need was met off the books (bdelanghe/brand#6).
//
// The resolution was that no decorative tier exists, because a rule that marks where
// one record ends is a schematic marker, and a marker not everyone can see is not
// marking anything — while "it is only decorative" is not available either, since a
// line placed deliberately to be read as a boundary is not decoration. So the palette
// gate cannot see this substitution, and the consumer's own gate has to. Hierarchy
// between rules belongs on the axes that are not contrast-regulated — spacing, length,
// the label above the section — never on a fainter colour.
//
// WHAT IT DOES NOT COVER, said plainly: a rule drawn as a 1px GRID GAP showing the
// container's background through it (`display: grid; gap: 1px; background: <surface>`)
// is the same marker by another mechanism, and this check cannot see it — the property
// is `background`, and telling a 1px gap from a real fill needs layout the scanner does
// not have. Two such rules existed here and were moved to --bs-color-line by hand. If
// that pattern comes back it will pass this gate, so it is worth knowing about rather
// than assuming the check is total.
//
// Dependency-free by design (the repo hand-rolls its validators to stay hermetic).
// Not a regex sweep: a small declaration-aware scanner. A ':' whose value ends at
// ';' or '}' is a declaration (scanned); a ':' that runs into '{' is a selector
// pseudo (skipped) — so #id selectors, :hover, and @media preludes don't false-fire.
// url(...) and string literals are stripped so '#' in url(#id) or a hex in content
// can't trip it.
//
// Exported: checkCss({ root, brand }) -> { ok, violations, vocabSize }
// CLI:      node scripts/check-css.mjs   (prints + exits 1 on any violation)

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The 148 CSS named colors are palette decisions → must be tokens.
const NAMED_COLORS = new Set(("aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen").split(" "));
// Keywords that read like colors but are not palette decisions → allowed.
// (transparent / currentcolor / inherit / etc. are NOT in NAMED_COLORS above.)

// The page/card surfaces. All three are near-white by construction, so none can clear
// 3:1 against another — using one as a border is always below the hairline floor, which
// is why this is decidable by NAME and needs no ratio math here. Deliberately not a
// blanket "every bg token": --bs-color-accent is a legitimate border colour and clears
// the floor on its own. There is no opt-out; a case for one is an argument to have in
// the brand's palette contract, not a comment in this file.
const SURFACE_TOKENS = new Set([
  "--bs-color-paper",
  "--bs-color-card",
  "--bs-color-card-alt",
]);
// Properties whose value paints a LINE. `border`/`outline` shorthands included: their
// color component lands in the same value string.
const RULE_PROP = /^(border|outline|column-rule)(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?$/;

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color)\s*\(/i;

const scanValue = (val, line, vocab, out, prop = "") => {
  // strip strings + url() so a '#' or hex inside them can't false-fire
  const v = val.replace(/"[^"]*"|'[^']*'/g, " ").replace(/url\([^)]*\)/gi, " ");
  // token-membership: every var(--bs-*) must be defined by the brand
  for (const m of v.matchAll(/var\(\s*(--bs-[\w-]+)/g))
    if (!vocab.has(m[1])) out.push({ line, kind: "unknown-token", detail: m[1] });
  // surface-as-border: a fill token in a line position
  if (RULE_PROP.test(prop))
    for (const m of v.matchAll(/var\(\s*(--bs-[\w-]+)/g))
      if (SURFACE_TOKENS.has(m[1]))
        out.push({ line, kind: "surface-as-border", detail: `${prop}: ${m[1]}` });
  // literal colors — hex + color functions (token refs contain neither)
  const hex = v.match(HEX);
  if (hex) out.push({ line, kind: "literal-color", detail: hex[0] });
  const fn = v.match(COLOR_FN);
  if (fn) out.push({ line, kind: "literal-color", detail: fn[1].toLowerCase() + "()" });
  // named colors — strip --bs-* identifiers first so a token's own word
  // (e.g. --bs-color-accent) isn't mistaken for a CSS named-color keyword
  const bare = v.replace(/--bs-[\w-]+/g, " ").toLowerCase();
  for (const w of bare.match(/\b[a-z]+\b/g) || [])
    if (NAMED_COLORS.has(w)) out.push({ line, kind: "named-color", detail: w });
};

export async function checkCss({ root, brand }) {
  const css = await readFile(join(root, "styles.css"), "utf8");

  // vocabulary = every --bs-* custom property the brand DEFINES (the source of truth)
  const vocab = new Set();
  for (const p of ["tokens/tokens.css", "css/base.css", "css/fonts.css"]) {
    let txt = "";
    try { txt = await readFile(join(brand, p), "utf8"); } catch { /* optional */ }
    for (const m of txt.matchAll(/(--bs-[\w-]+)\s*:/g)) vocab.add(m[1]);
  }

  const out = [];
  let i = 0, line = 1;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === "/" && css[i + 1] === "*") {           // skip comments (keep line count)
      i += 2;
      while (i < n && !(css[i] === "*" && css[i + 1] === "/")) { if (css[i] === "\n") line++; i++; }
      i += 2; continue;
    }
    if (c === ":") {                                  // candidate declaration value
      // The property is the identifier running back to the previous declaration or
      // block boundary — needed by check 3, which is property-sensitive.
      let k = i - 1;
      while (k >= 0 && !";{}".includes(css[k])) k--;
      const prop = css.slice(k + 1, i).trim().toLowerCase();
      let j = i + 1, paren = 0, term = "", val = "";
      while (j < n) {
        const d = css[j];
        if (d === "(") paren++;
        else if (d === ")") paren = Math.max(0, paren - 1);
        else if (paren === 0 && (d === ";" || d === "}" || d === "{")) { term = d; break; }
        val += d; j++;
      }
      if (term === ";" || term === "}") {             // real declaration → scan
        scanValue(val, line, vocab, out, prop);
        for (const ch of val) if (ch === "\n") line++;
        i = term === ";" ? j + 1 : j;                 // leave '}' for the loop
        continue;
      }
      // term === '{' (or EOF): a selector pseudo / at-rule prelude → skip the ':'
    }
    i++;
  }
  return { ok: out.length === 0, violations: out, vocabSize: vocab.size };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { ok, violations, vocabSize } = await checkCss({ root, brand: join(root, "node_modules", "@bdelanghe", "brand") });
  if (!ok) {
    console.error(`✗ css-token-purity: ${violations.length} violation(s) in styles.css — every color must be a brand token (docs/css-token-purity.md):`);
    for (const v of violations) console.error(`    styles.css:${v.line}  ${v.kind}: ${v.detail}`);
    if (violations.some((v) => v.kind === "surface-as-border"))
      console.error(
        "\n  A surface token in a border position is a fill doing a border's job, below\n" +
        "  the 3:1 the palette contract requires of a hairline. Use --bs-color-line, or\n" +
        "  carry the distinction with spacing instead of a fainter rule.",
      );
    process.exit(1);
  }
  console.log(`✓ css-token-purity: styles.css speaks only in brand tokens — 0 raw colors, all var(--bs-*) ∈ vocabulary (${vocabSize} tokens).`);
}
