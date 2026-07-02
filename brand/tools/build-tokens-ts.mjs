#!/usr/bin/env node
// Generate brand/tokens/tokens.ts from tokens.json via Style Dictionary.
//   node tools/build-tokens-ts.mjs          # write tokens/tokens.ts
//   node tools/build-tokens-ts.mjs --check  # exit 1 if tokens.ts is stale (CI drift gate)
//
// Drives the same `ts` platform / custom format registered in
// style-dictionary.config.mjs, so `npm run build:sd` and this writer produce
// identical bytes. Mirrors tokens/build-tokens.mjs (the tokens.css drift check).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import StyleDictionary from "style-dictionary";
import config from "../style-dictionary.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const tsPath = join(here, "..", "tokens", "tokens.ts");

const sd = new StyleDictionary(config, { verbosity: "silent" });
const [{ output }] = await sd.formatPlatform("ts");

if (process.argv.includes("--check")) {
  let current = "";
  try { current = readFileSync(tsPath, "utf8"); } catch {}
  if (current !== output) {
    console.error("✗ tokens/tokens.ts is stale. Run: node tools/build-tokens-ts.mjs");
    process.exit(1);
  }
  console.log("✓ tokens/tokens.ts is up to date.");
} else {
  writeFileSync(tsPath, output);
  console.log("✓ wrote tokens/tokens.ts");
}
