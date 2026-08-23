#!/usr/bin/env node
// brand-source gate — what the repoint to npm did, and did NOT, remove.
//
// THIS FILE USED TO CHECK SOMETHING ELSE. @bdelanghe/brand had no registry
// release, so it was a git dependency pinned TWICE — package-lock.json for
// `npm ci`, flake.lock for the hermetic build whose output is signed and served —
// and this gate compared the two revisions. Drift was silent by construction:
// both builds succeed and every other gate stays green, because the token gates
// read node_modules while dist/ comes from Nix.
//
// @bdelanghe/brand@0.1.0 is now on npm with provenance, so the npm half of that
// pin pair is a registry version and there is no git revision left to compare.
// Two things follow, and only the first is a mechanism:
//
//   1. ENFORCED HERE. brand resolves from the registry, not from git, and
//      .npmrc's allow-git stays `none`. This is the regression guard: a future
//      `npm i github:bdelanghe/brand` would reintroduce the git dependency, and
//      with it the setting that had to permit it.
//
//   2. DISCLOSED, NOT ENFORCED. flake.nix still carries its own `brand` input,
//      so the hermetic build composes against a git commit while `npm ci`
//      composes against a registry tarball. Those can still drift — the same
//      silent failure as before, one pin narrower.
//
// The residual is not checkable from here and this gate says so rather than
// implying otherwise. Making it checkable needs one of:
//   - the Nix build consuming the npm package (buildNpmPackage + npmDepsHash),
//     which retires flake.nix's brand input and the drift with it; or
//   - brand cutting git tags that correspond to its npm versions, so the flake
//     can pin `v<version>` and the correspondence is readable offline. brand has
//     NO tags today — 0.1.0 was published by the bootstrap, from a commit, with
//     nothing naming it.
// Tracked in bdelanghe/site#274.
//
// A gate that reported this as passing would be the thing this repo treats as a
// defect elsewhere: a green check that gates nothing.

import { readFile } from "node:fs/promises";

const read = async (p) => readFile(new URL(`../${p}`, import.meta.url), "utf8");
const j = async (p) => JSON.parse(await read(p));

let failed = false;
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true; };

// --- 1. enforced: brand comes from the registry, and git resolution stays off
const lock = await j("package-lock.json");
const entry = Object.entries(lock.packages ?? {})
  .find(([k]) => k.endsWith("node_modules/@bdelanghe/brand"));
if (!entry) {
  fail("brand-source: no @bdelanghe/brand entry in package-lock.json.");
} else {
  const resolved = entry[1].resolved ?? "";
  console.log(`  @bdelanghe/brand  ${entry[1].version}  ${resolved}`);
  if (!resolved.startsWith("https://registry.npmjs.org/")) {
    fail(
      `brand-source: @bdelanghe/brand resolves from ${resolved || "(nothing)"}, not the registry.\n` +
        "  It is a published package now — a git dependency here reintroduces the second\n" +
        "  pin this gate used to police, and forces .npmrc's allow-git back off `none`.",
    );
  }
}

const gitDeps = Object.entries(lock.packages ?? {})
  .filter(([, v]) => /^(git\+|github:)/.test(String(v.resolved ?? "")))
  .map(([k]) => k);
if (gitDeps.length) fail(`brand-source: git-resolved dependencies present: ${gitDeps.join(", ")}`);

const npmrc = await read(".npmrc");
if (!/^allow-git=none$/m.test(npmrc)) {
  fail("brand-source: .npmrc no longer sets allow-git=none — nothing in this repo needs git resolution.");
}

// --- 2. disclosed: the flake still pins brand independently
const flake = await j("flake.lock");
const flakeNode = Object.entries(flake.nodes ?? {})
  .find(([name, n]) => name.toLowerCase().includes("brand") || n?.locked?.repo === "brand");
if (flakeNode) {
  const rev = flakeNode[1]?.locked?.rev ?? "(none)";
  console.log(`  flake.lock brand  ${String(rev).slice(0, 12)}   nix build .#site → dist/`);
  console.log(
    "\n  ! DISCLOSED, NOT CHECKED: the hermetic build composes against that commit while\n" +
      "    `npm ci` composes against the registry tarball above. They can drift, silently,\n" +
      "    exactly as the two git pins could. Not comparable from here — brand publishes no\n" +
      "    gitHead in its tarball and has no tags. See bdelanghe/site#274.",
  );
}

if (failed) process.exit(1);
console.log("\n✓ brand-source: brand comes from the registry and no dependency resolves from git.");
