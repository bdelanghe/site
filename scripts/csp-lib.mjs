// Shared derivation for the CSP scripts. Kept in one place deliberately: the generator
// and the gate must agree on what an "inline block" IS, or the gate proves nothing about
// the policy the generator wrote. What they must NOT share is the decision — the gate
// re-derives from the built bytes and compares, rather than trusting a recorded answer.
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";

// <script> with no src=, and <style>. An ld+json block counts: browsers disagree on
// whether a data block is subject to script-src, so it is hashed and the question is moot.
const SCRIPT_RE = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const STYLE_RE = /<style([^>]*)>([\s\S]*?)<\/style>/gi;
export const STYLE_ATTR_RE = /\sstyle\s*=\s*"/gi;

export const hash = (body) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;

export async function htmlFiles(dist) {
  const out = [];
  for (const ent of await readdir(dist, { withFileTypes: true, recursive: true })) {
    if (ent.isFile() && ent.name.endsWith(".html")) out.push(join(ent.parentPath ?? ent.path, ent.name));
  }
  return out.sort();
}

// The hash covers the EXACT bytes between the tags — no trimming. A browser hashes what
// is there, so anything this normalises would be a policy that validates and still blocks.
export async function collect(dist) {
  const scripts = new Set(), styles = new Set(), attrs = [];
  for (const file of await htmlFiles(dist)) {
    const html = await readFile(file, "utf8");
    for (const m of html.matchAll(SCRIPT_RE)) scripts.add(hash(m[2]));
    for (const m of html.matchAll(STYLE_RE)) styles.add(hash(m[2]));
    const n = [...html.matchAll(STYLE_ATTR_RE)].length;
    if (n) attrs.push({ file: relative(dist, file), n });
  }
  return { scripts: [...scripts].sort(), styles: [...styles].sort(), attrs };
}

// connect-src carries api.github.com because the provenance freshness probe compares the
// deployed commit against the repo's main; everything else this site loads is same-origin.
export const policy = ({ scripts, styles }) => [
  "default-src 'none'",
  `script-src ${scripts.join(" ")}`,
  `style-src 'self' ${styles.join(" ")}`,
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const UNSAFE = ["'unsafe-inline'", "'unsafe-hashes'", "'unsafe-eval'"];
