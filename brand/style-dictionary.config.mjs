// Style Dictionary — native / Figma outputs from tokens.json (W3C DTCG format).
//   npm run build:sd   → writes dist/
//
// tokens.css stays the curated WEB artifact (build-tokens.mjs owns it, incl. the
// composite .bs-text-* classes). Style Dictionary covers everything else.
//
// Composite typography tokens (the `text` group) are excluded from the flat
// native platforms (iOS/Android) where a single value is expected; they survive
// intact in the scss / js / json outputs.
const noTypography = (token) => token.path[0] !== "text";

// Typed TS module — the idiomatic JSR default export. Lives in tokens/ (a
// committed, drift-checked source artifact), not dist/ (regenerated, gitignored).
import tsFormat from "./tools/sd-format-tokens-ts.mjs";

export default {
  hooks: { formats: { [tsFormat.name]: tsFormat.format } },
  source: ["tokens/tokens.json"],
  platforms: {
    ts: {
      transformGroup: "js",
      buildPath: "tokens/",
      files: [{ destination: "tokens.ts", format: tsFormat.name }],
    },
    scss: {
      transformGroup: "scss",
      buildPath: "dist/",
      files: [{ destination: "tokens.scss", format: "scss/variables" }],
    },
    js: {
      transformGroup: "js",
      buildPath: "dist/",
      files: [{ destination: "tokens.js", format: "javascript/es6" }],
    },
    json: {
      transformGroup: "js",
      buildPath: "dist/",
      // Flat map — convenient for Figma Tokens / Tokens Studio import.
      files: [{ destination: "tokens.flat.json", format: "json/flat" }],
    },
    ios: {
      transformGroup: "ios-swift",
      buildPath: "dist/",
      files: [
        {
          destination: "Tokens.swift",
          format: "ios-swift/class.swift",
          options: { className: "BSTokens" },
          filter: noTypography,
        },
      ],
    },
    android: {
      transformGroup: "android",
      buildPath: "dist/",
      files: [
        {
          destination: "tokens.xml",
          format: "android/resources",
          filter: noTypography,
        },
      ],
    },
  },
};
