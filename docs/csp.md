# Content-Security-Policy — hashes, and no `unsafe-*`

The site ships a strict CSP with **no `'unsafe-inline'`, no `'unsafe-hashes'`, no
`'unsafe-eval'`**, generated from the built bytes and gated three ways.

```
default-src 'none';
script-src  'sha256-…' ×5;
style-src   'self' 'sha256-…' ×4;
img-src 'self'; font-src 'self'; manifest-src 'self';
connect-src 'self' https://api.github.com;
base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

`default-src 'none'` means anything not named above is refused, so a new resource type has
to be added deliberately rather than inherited by accident.

## Why this was follow-up work rather than a line added on faith

`build.mjs` carried the reason for years:

> A CSP shipped without testing against the live edge is a broken page, so it is follow-up
> work with a real test, not a line added on faith.

Two obstacles stood in the way, and both had to be removed first.

**1. Style attributes.** A `<style>` block can be hashed. A `style=""` **attribute** cannot —
covering one requires `'unsafe-hashes'`, which also re-permits every other inline handler
the policy exists to refuse. The build emitted 42 of them: 40 data-driven `width:N%` on the
language and conformance bars, and 2 static ones on `.prov-seal__note`.

They are gone. Widths are now **classes** — `.w-0 … .w-100`, a static set appended to the
fingerprinted stylesheet (`widthUtilities` in `build.mjs`). Static, because the set cannot
depend on the data: the stylesheet is fingerprinted before the pages that pick a width are
rendered. It is 101 near-identical rules, ~2.5 KB raw, and gzips to almost nothing. The
conformance meter rounds to integers with the **last segment taking the remainder**, so the
three always sum to exactly 100 and the track never gaps. The two static attributes moved
into `styles.css` under the class the elements already carried.

**2. A style attribute set at runtime.** The provenance freshness probe called
`el.setAttribute("style", …)` on the note it injects — blocked under this policy just as
surely as a literal attribute, and silently. Those declarations now live in `styles.css`
keyed off `#build-freshness`, the id the script already sets.

## `ld+json` is hashed too

Browsers disagree about whether a `<script type="application/ld+json">` data block is
subject to `script-src`. Rather than depend on the answer, every inline `<script>` is
hashed — data blocks included — so the policy holds either way.

## One policy, not one per route

The policy goes in the sitewide `/*` block of `_headers` with the **union** of all hashes.
Cloudflare **merges** overlapping `_headers` rules, and two `Content-Security-Policy`
headers on one response are enforced as their **intersection** — a per-route policy would
combine with the sitewide one and block whatever the two do not both allow. `gen-csp.mjs`
refuses to add a second policy line for that reason.

The cost is precision: a hash valid on one page is accepted on all of them. That is a much
smaller hole than the alternative, and the alternative breaks pages.

## The three gates

| Gate | Runs | Proves |
|---|---|---|
| `scripts/gen-csp.mjs` | last in `npm run build`, after `gen-attestation.mjs` stamps `provenance.html` | the policy is derived from the **final** served bytes |
| `npm run check:csp` (`csp-gate.mjs`) | build + `csp.yml` | every inline block's hash **re-derived from `dist/`** is in the policy; no `unsafe-*`; no surviving style attribute; `default-src 'none'` present |
| `npm run check:csp-browser` (`csp-browser-gate.mjs`) | `csp.yml` | every route **loads clean in Chromium** under the policy — zero `securitypolicyviolation`, and the email de-obfuscator provably ran |

`csp-gate.mjs` re-derives rather than trusting anything `gen-csp.mjs` recorded: a gate's own
claim about itself is not evidence (`docs/agentic-code-hygiene.md` rule 3).

The browser gate is the one that matters most. A hash-based policy that is one byte stale
does not warn — it silently kills the script, and the page looks fine until someone notices
the email link never resolved. So "no violation" is **observed**, and the gate additionally
asserts the de-obfuscator replaced its `[data-mail]` span with a real `mailto:` link.

### Against served pages, not just built ones

`node scripts/csp-browser-gate.mjs https://robertdelanghe.dev` runs the same checks against
the **live** origin, reading the policy from the edge. That is the only place a CDN which
drops, rewrites, or doubles the header is visible — the build cannot see it. `csp.yml`'s
`live` job runs it on a `workflow_run` trigger after `deploy` completes.

It is not in `deploy.yml` because this repo's post-deploy verification is the canonical
reusable pipeline in `bounded-systems/.github` (`site-deploy.yml`), pinned by SHA; a step
added there would change every site that calls it.

## Deliberately not set

- **`'unsafe-hashes'`** — see above. The attributes were removed instead.
- **`report-uri` / `report-to`** — no collector, and a reporting endpoint that nothing reads
  is worse than none: it implies the violations are being watched.
- **HSTS `preload`** — unrelated to CSP, and still deliberate: the token advertises consent
  to the browser preload list, which covers every subdomain and is slow and painful to
  leave. `max-age` and `includeSubDomains` are set; joining the list is a decision.
