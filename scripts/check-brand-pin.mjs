#!/usr/bin/env node
// brand-source gate — one artifact, two consumers, and that fact enforced.
//
// THIS FILE HAS CHECKED THREE DIFFERENT THINGS, because the thing worth checking
// kept changing:
//
//   1. @bdelanghe/brand had no registry release, so it was a git dependency
//      pinned TWICE — package-lock.json for `npm ci`, flake.lock for the
//      hermetic build whose output is signed and served. This compared the two
//      revisions. Drift was silent by construction: both builds succeed and
//      every other gate stays green, because the token gates read node_modules
//      while dist/ comes from Nix.
//
//   2. brand@0.1.0 reached npm (#275), so the npm half became a registry version
//      and there was no git revision left to compare. This enforced "not from
//      git" and DISCLOSED the surviving flake pin, because comparing a tarball
//      to a commit needs nix and the session had none.
//
//   3. The flake input is now the npm tarball ITSELF. One artifact, two
//      consumers, flake.lock pinning its narHash. The drift is not checked — it
//      is unrepresentable, which is the outcome #274 asked for.
//
// So what remains is worth stating precisely: the only way the two builds can
// diverge again is if someone EDITS one of the two references so they name
// different artifacts. That is a text comparison, needs no nix, and is what this
// enforces. A `brand-parity.yml` job existed to byte-compare the two sources; it
// is deleted, because comparing an artifact to itself is theatre.

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

// --- 2. enforced: the flake consumes the SAME artifact npm does
//
// `flake.lock`'s locked url is what `nix build` actually fetches, so that is the
// side compared — not flake.nix's declared url, which a stale lock could differ
// from. If these two strings agree, the bytes agree by construction, and
// narHash pins them on the Nix side.
const flake = await j("flake.lock");
const brandNode = flake.nodes?.brand;
if (!brandNode) {
  fail("brand-source: flake.lock has no `brand` input. If the flake stopped consuming brand, delete this half of the gate deliberately rather than leaving it unable to find its subject.");
} else {
  const flakeUrl = brandNode.locked?.url ?? "";
  const npmUrl = entry?.[1]?.resolved ?? "";
  console.log(`  flake.lock brand  ${flakeUrl || "(no url — not a tarball input?)"}`);
  if (brandNode.locked?.type !== "tarball") {
    fail(
      `brand-source: flake.lock's brand input is type '${brandNode.locked?.type}', not 'tarball'.\n` +
        "  A git input reintroduces the second artifact and with it the silent drift\n" +
        "  between the served build and everything the gates checked (#274).",
    );
  } else if (flakeUrl !== npmUrl) {
    fail(
      "brand-source: the flake and npm name DIFFERENT artifacts.\n" +
        `    flake.lock       ${flakeUrl}\n` +
        `    package-lock.json ${npmUrl}\n` +
        "  The hermetic build composes dist/ — signed, attested, served — from the first,\n" +
        "  while every gate checked the second. Both builds succeed; nothing goes red.\n" +
        "  Fix: point flake.nix at the version package.json ranges over, then\n" +
        "  `nix flake update brand`.",
    );
  }
}

if (failed) process.exit(1);
console.log("\n✓ brand-source: the flake and npm consume the same published artifact, and nothing resolves from git.");
