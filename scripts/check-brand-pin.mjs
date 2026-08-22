#!/usr/bin/env node
// brand-pin gate — the two pins that must not drift.
//
// @bdelanghe/brand is not published to a registry. It has no tags and no release;
// it is a git dependency, and this repo pins it TWICE, by two different tools, for
// two different builds:
//
//   package-lock.json   resolved: git+ssh://…/brand.git#<commit>
//                       what `npm ci` installs — the dev/CI path, and what
//                       token-a11y reads out of node_modules.
//   flake.lock          nodes.brand.locked.rev
//                       what `nix build .#site` copies in — the HERMETIC path, the
//                       one whose output is signed, attested and served.
//
// flake.nix says so in a comment: "Brand pinned here (flake.lock) for the hermetic
// build, independent of the @bdelanghe/brand npm dependency (kept only for non-Nix
// dev). Bump both together."
//
// "Bump both together" is a discipline, and a discipline is not a mechanism. If the
// two drift, `npm run build` and `nix build .#site` compose the site against
// DIFFERENT token sets, and every gate stays green because each is internally
// consistent — the token-a11y gate reads node_modules, the built dist/ comes from
// Nix. The failure is silent by construction, which is exactly the shape this repo
// treats as a defect elsewhere: a property worth having is a check, not a comment.
//
// This is that check. It asserts one thing and says what it means when it fails.

import { readFile } from "node:fs/promises";

const j = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));

const lock = await j("package-lock.json");
const flake = await j("flake.lock");

const pkgEntry = Object.entries(lock.packages ?? {})
  .find(([k]) => k.endsWith("node_modules/@bdelanghe/brand"));
if (!pkgEntry) {
  console.error("✗ brand-pin: no @bdelanghe/brand entry in package-lock.json.");
  process.exit(1);
}
const npmRev = (pkgEntry[1].resolved ?? "").split("#")[1];

const flakeNode = Object.entries(flake.nodes ?? {})
  .find(([name, n]) => name.toLowerCase().includes("brand") || n?.locked?.repo === "brand");
if (!flakeNode) {
  console.error("✗ brand-pin: no brand input in flake.lock.");
  process.exit(1);
}
const nixRev = flakeNode[1]?.locked?.rev;

const short = (r) => (r ? r.slice(0, 12) : "(none)");
console.log(`  package-lock.json  ${short(npmRev)}   npm ci → node_modules`);
console.log(`  flake.lock         ${short(nixRev)}   nix build .#site → dist/`);

if (!npmRev || !nixRev) {
  console.error("\n✗ brand-pin: could not read one of the two revisions.");
  process.exit(1);
}
if (npmRev !== nixRev) {
  console.error(
    `\n✗ brand-pin: the two brand pins have drifted.\n` +
      `\n  ${short(npmRev)} is what npm installs; ${short(nixRev)} is what the hermetic\n` +
      "  build composes the served site against. Both builds will succeed and every\n" +
      "  other gate will stay green, because each is internally consistent — the\n" +
      "  token gates read node_modules while dist/ comes from Nix. The site would be\n" +
      "  built against tokens no local check ever saw.\n" +
      "\n  Bump both: `nix flake update brand` and reinstall the npm dependency, then\n" +
      "  commit flake.lock and package-lock.json together.",
  );
  process.exit(1);
}
console.log(`\n✓ brand-pin: both pins name ${short(npmRev)} — npm and Nix compose against the same brand.`);
