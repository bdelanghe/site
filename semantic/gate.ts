// semantic/gate.ts — bless each rendered post's DOM with lone (semantic HTML + a11y).
// Warn-only for now: reports findings, never fails the build. Run from the site root
// after `node build.mjs`, with bounded-systems/lone cloned at ./lone.
import { parseHTML } from "linkedom";
import { validate } from "../lone/src/mod.ts";

const DIR = "dist/blog";
let posts = 0, total = 0;
try {
  for await (const e of Deno.readDir(DIR)) {
    if (!e.name.endsWith(".html")) continue;
    posts++;
    const { document } = parseHTML(await Deno.readTextFile(`${DIR}/${e.name}`));
    const subject = document.querySelector("article") ?? document.body;
    const { findings } = await validate(subject);
    if (findings.length) {
      total += findings.length;
      console.log(`\n${e.name} — ${findings.length} finding(s):`);
      for (const f of findings) console.log(`  [${f.severity}] ${f.code} ${f.path} — ${f.message}`);
    } else console.log(`${e.name} — clean`);
  }
} catch (err) {
  console.log(`lone gate: could not run (${err.message}) — non-blocking`);
}
console.log(`\nlone: ${posts} post(s) · ${total} finding(s) [warn-only]`);
