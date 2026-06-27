#!/usr/bin/env node
// Schema check: validate the data contracts against their JSON Schemas, standalone.
// build.mjs already validates at load, but this is the CI/local convenience gate —
// `npm run check:schema` — that fails loudly before a build is even attempted.
//
// - data/profile.json      → the canonical résumé, against the JSON Resume schema.
// - data/presentation.json → the homepage render context, against its own schema.
// - data/copy.json         → the atomic-copy UI atoms, against the copy contract.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../schema-validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const j = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

const checks = [
  ["data/profile.json", "contract/jsonresume.schema.json"],
  ["data/presentation.json", "contract/presentation.schema.json"],
  ["data/copy.json", "contract/copy.schema.json"],
];

let bad = 0;
for (const [data, schema] of checks) {
  const errs = validateSchema(await j(schema), await j(data));
  if (errs.length) {
    bad++;
    console.error(`✗ ${data} violates ${schema}:`);
    for (const e of errs) console.error(`    ${e}`);
  } else {
    console.log(`✓ ${data} valid against ${schema}`);
  }
}
process.exit(bad ? 1 : 0);
