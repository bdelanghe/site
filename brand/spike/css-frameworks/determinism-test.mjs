#!/usr/bin/env node
// Discriminating determinism test (the one to run before trusting any atomic tool).
// Two classes set the SAME property from two files. The naive answer (last in the
// class attribute) is wrong because precedence comes from stylesheet order. We
// render BOTH import orders in headless Chrome and read the computed colour — if
// the winner flips, conflict resolution is order-dependent (the footgun).
//
//   CHROME="/path/to/chrome" node determinism-test.mjs
import { writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = mkdtempSync(join(tmpdir(), "det-"));
writeFileSync(join(dir, "a.css"), ".util-a { color: rgb(200, 0, 0); }\n"); // red
writeFileSync(join(dir, "b.css"), ".util-b { color: rgb(0, 0, 200); }\n"); // blue

const page = (order) => `<!doctype html><html><head>
${order.map((f) => `<link rel="stylesheet" href="${f}">`).join("\n")}
</head><body><span id="t" class="util-a util-b">x</span>
<script>document.title = getComputedStyle(document.getElementById("t")).color;</script>
</body></html>`;

function winner(order) {
  const f = join(dir, "p-" + order.join("-").replace(/\./g, "") + ".html");
  writeFileSync(f, page(order));
  const dom = execFileSync(CHROME, ["--headless", "--disable-gpu", "--dump-dom", `file://${f}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return (dom.match(/<title>([^<]*)<\/title>/) || [, "?"])[1];
}

const ab = winner(["a.css", "b.css"]); // b last in the stylesheet order
const ba = winner(["b.css", "a.css"]); // a last
const blue = "rgb(0, 0, 200)", red = "rgb(200, 0, 0)";
console.log(`\n  CASCADE-ORDER DETERMINISM TEST`);
console.log(`  <span class="util-a util-b"> — both classes set color\n`);
console.log(`  import [a, b] → ${ab}${ab === blue ? "  (util-b won)" : ""}`);
console.log(`  import [b, a] → ${ba}${ba === red ? "  (util-a won)" : ""}`);
console.log(`\n  winner ${ab === ba ? "is STABLE across import order ✓" : "FLIPS with import order ✗ — order-dependent (the footgun)"}`);
console.log(`\n  Plain atomic CSS resolves by stylesheet order. StyleX would emit only the`);
console.log(`  winning class at the call site (no cascade conflict); the semantic-CSS +`);
console.log(`  tokens approach has no competing atomics to begin with.\n`);
