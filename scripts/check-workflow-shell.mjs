#!/usr/bin/env node
// workflow-shell gate — every `run:` block must be a shell script bash can parse.
//
// Written because a one-character mistake took the deploy down silently. deploy.yml
// signs inside a nix devShell:
//
//   nix develop .#deploy --command bash -euo pipefail -c '
//     …
//     cosign sign-blob …
//   '
//
// A comment inside that block gained a raw apostrophe — `(nix build's buildPhase)`.
// It closed the single-quoted string, so `cosign` ran in the OUTER shell, where the
// devShell's tools are not on PATH. The failure surfaced as `cosign: command not
// found`: an error about the wrong thing entirely, two dozen lines from its cause.
// The line directly above it in the same block already escaped an apostrophe
// correctly (`nix build'\''s`), which is what makes it easy to miss in review.
//
// bash -n catches it, so run bash -n. GitHub expressions are substituted first —
// `${{ … }}` is not valid parameter expansion and would be a false positive.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const dir = ".github/workflows";

// A `run: |` (or `run: >`) block, plus its indented body.
const BLOCK = /^(\s+)run:\s*[|>]-?\s*\n((?:\1\s+.*\n|\s*\n)*)/gm;

let checked = 0, bad = 0;
for (const f of (await readdir(dir)).filter((f) => /\.ya?ml$/.test(f)).sort()) {
  const src = await readFile(join(dir, f), "utf8");
  for (const m of src.matchAll(BLOCK)) {
    const indent = m[1].length + 2;
    const body = m[2].split("\n").map((l) => l.slice(indent)).join("\n");
    // GitHub expressions are not shell; give bash something inert in their place.
    const shell = body.replace(/\$\{\{[^}]*\}\}/g, "GH_EXPR");
    if (!shell.trim()) continue;
    checked++;
    const line = src.slice(0, m.index).split("\n").length;
    try {
      await run("bash", ["-n", "-c", shell]);
    } catch (e) {
      bad++;
      const why = String(e.stderr || e.message).trim().split("\n").slice(0, 3).join("\n        ");
      console.error(`  ✗ ${f}:${line}\n        ${why}`);
    }
  }
}

if (bad) {
  console.error(
    `\n✗ workflow-shell: ${bad} of ${checked} run block(s) do not parse.\n` +
      "\n  An unterminated quote does not fail loudly — it repartitions the script, and\n" +
      "  the error surfaces later as a missing command. Inside a single-quoted string,\n" +
      "  write an apostrophe as '\\''  (close, literal, reopen).\n",
  );
  process.exit(1);
}
console.log(`✓ workflow-shell: ${checked} run block(s) across the workflows parse as shell.`);
