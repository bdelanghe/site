#!/usr/bin/env node
// Version-sync gate for the dual (npm + JSR) publish. package.json and deno.json
// must declare the SAME version, or one registry ships a lie. When run in the
// release workflow (tag push), the git tag must agree too.
//   node tools/verify-versions.mjs            # package.json === deno.json
//   node tools/verify-versions.mjs <tag>      # …and the tag (e.g. v1.3.0) matches
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => JSON.parse(readFileSync(join(root, f), "utf8"));

const pkg = read("package.json").version;
const den = read("deno.json").version;

let ok = pkg === den;
if (!ok) console.error(`✗ version mismatch: package.json=${pkg} deno.json=${den}`);

const tagArg = process.argv[2];
if (tagArg) {
  const tag = tagArg.replace(/^refs\/tags\//, "");
  if (tag !== `v${pkg}`) {
    console.error(`✗ tag ${tag} != v${pkg} (package.json)`);
    ok = false;
  }
}

if (!ok) process.exit(1);
console.log(`✓ versions agree: ${pkg}${tagArg ? ` (tag ${tagArg})` : ""}`);
