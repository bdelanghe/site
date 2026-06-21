#!/usr/bin/env node
// Assemble the static site into dist/ — the page plus the brand design-system
// assets it references (tokens + css/fonts). Self-contained, deployable anywhere.
import { rm, mkdir, cp, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const brand = join(root, "brand");

async function exists(p) { try { await access(p); return true; } catch { return false; } }

if (!(await exists(join(brand, "tokens", "tokens.css")))) {
  console.error("✗ brand/ is empty. Run: git submodule update --init --recursive");
  process.exit(1);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const f of ["index.html", "styles.css"]) {
  await cp(join(root, f), join(dist, f));
}

await mkdir(join(dist, "brand"), { recursive: true });
for (const p of ["tokens/tokens.css", "css"]) {
  await cp(join(brand, p), join(dist, "brand", p), { recursive: true });
}

console.log("✓ built dist/  (deploy this folder)");
