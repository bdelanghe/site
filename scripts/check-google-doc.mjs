#!/usr/bin/env node
// Google Doc link check: if data/profile.json advertises a public Google Doc
// (meta.googleDocs.publishedUrl — rendered as the /resume "Comment on Google
// Docs" button), verify it's actually reachable before it ships. A blocked or
// disabled doc returns a non-200 (403 for a Google abuse-detection block, seen
// firsthand: bdelanghe/site#186) with no redirect — this fails loudly instead
// of silently shipping a dead public link.
//
//   node scripts/check-google-doc.mjs
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = JSON.parse(await readFile(join(root, "data/profile.json"), "utf8"));
const url = profile.meta?.googleDocs?.publishedUrl;

if (!url) {
  console.log("✓ no public Google Doc link configured — nothing to check");
  process.exit(0);
}

const response = await fetch(url, { redirect: "follow" });
if (response.status !== 200) {
  console.error(`✗ Google Doc unreachable: ${url}`);
  console.error(`    HTTP ${response.status} — the doc may be blocked, disabled, or unshared.`);
  console.error(`    Either fix access, or remove meta.googleDocs from data/profile.json so the button stops rendering.`);
  process.exit(1);
}
console.log(`✓ Google Doc reachable: ${url}`);
