# RFC: atomic-copy — the verbal token layer

**Status:** Draft · **Owner:** Robert DeLanghe · **Scope:** robertdelanghe.dev (and the wider Bounded Systems sites)

> One word, "tokens", is doing two jobs. `baobab` owns the **visual** atoms (colors,
> type, space). This RFC names the **verbal** atoms — every shipped string as an
> addressable, typed, audited unit of copy — **atomic-copy**, the counterpart to
> design tokens. It carries one invariant: **no user-facing string is embedded
> directly in the site; every string is a copy atom, referenced by id.** Half of it
> already exists here; this RFC names it, states the invariant it should enforce, and
> decides where it lives.

## 1. The invariant

> **No user-facing string is embedded directly in the website. Every user-facing
> string is a copy atom (a token), referenced by id — never written inline in a
> template or markup.**

This is the exact analogue of the design-token rule, applied to copy:

| `baobab` / brand (visual) | atomic-copy (verbal) |
|---|---|
| **No hardcoded colors.** A template may not write `#A6432F`; it references `var(--bs-color-accent)`. | **No hardcoded strings.** A template may not write `The corpus`; it references a copy atom by id. |
| Inline hex is a lint failure (tokens drift-checked vs `brand/tokens/tokens.css`). | Inline user-facing text is a gate failure (`@bounded-systems/string-audit`). |
| One source of truth for the palette. | One source of truth for the words. |

The payoff is the same as for colors: every string is in one place, every string is
typed, and every string passes the audit gate — because there is nowhere else a string
can be. A string that isn't a copy atom can't ship, the way a color that isn't a token
can't ship. `string-audit` is the enforcing workflow: it can only police copy it can
see, and it can only see *every* string once *every* string is an atom.

**Scope of "user-facing string".** The invariant governs *copy* — text a human reads:
headings, labels, eyebrows, button text, prose, captions. It explicitly does **not**
govern structural strings that are not copy: CSS class names (`bs-text-label eyebrow`),
`href`/route values, schema keys, ARIA role tokens, MIME types, JSON-LD `@type`. Those
are markup, not words; they stay inline. The gate (§6) must draw exactly this line.

## 2. Definition

**atomic-copy** is the model in which *all website copy is addressable, typed, and
audited* — the verbal counterpart to design tokens.

| Property | Design tokens (`baobab`/brand) | atomic-copy (this RFC) |
|---|---|---|
| Atom | a visual primitive — `--bs-color-accent`, `--bs-font-mono` | a string — `hero.headline`, `exp.aura.b0` |
| Addressable | CSS custom property | dotted key into a token bag / catalog symbol |
| Typed | token group (color / type / space) | copy type (`headline` · `body` · `tagline` · `cta` · `claim`) |
| Sourced | `brand/tokens/tokens.json` | `data/profile.json` + `data/presentation.json` |
| Gate | drift-check vs `brand/tokens/tokens.css` | `@bounded-systems/string-audit` |

The unit is an **atom**: a single string with a stable address and a declared type.
"Addressable" means a post or template references the atom by name instead of
re-typing the words; "typed" means the auditor knows whether a string is a falsifiable
`claim` (route to grounding) or narrative `body` (prose checks only); "audited" means
every atom passes the same gate before a byte renders.

## 3. The problem it solves: "tokens" is overloaded

This repo already runs **two** token systems that share one word:

- **Design tokens** — the `brand/` submodule. `brand/tokens/tokens.css`,
  `brand/tokens/tokens.json`: the visual primitives. `build.mjs` even attests them by
  digest, calling them *"the tokens (visual)"* (`build.mjs:286`).
- **Copy tokens** — `build.mjs` builds a `tokens = { … }` **bag** (`build.mjs:107–114`)
  of content strings + profile slugs, and posts transclude facts from it via
  `{{thesis}}`, `{{proof.*}}`, `{{email}}`. The same `build.mjs:286` comment calls
  `brand/content/strings.json` *"content strings (verbal)"*.

So the word "tokens" names both the visual atoms **and** the verbal atoms. That is the
overload. Costs:

1. **Ambiguous conversation.** "Edit the tokens" is undefined — colors, or copy?
2. **No name for the verbal layer.** The copy system is real (a bag, a transclusion
   syntax, a typed catalog, a gate) but unnamed — it can't be referenced, documented,
   or extracted as a unit.
3. **Asymmetry with `baobab`.** Visual structure has a name and a fresh home repo
   (`bounded-systems/baobab`); verbal structure has neither, despite being further
   along here.

`atomic-copy` fixes all three: it disambiguates from design tokens, names the existing
machinery, and gives the verbal layer a sibling identity to `baobab`.

```
baobab        →  visual structure   →  design atoms   (colors · type · space)
atomic-copy   →  verbal structure   →  copy atoms     (headline · body · claim · cta)
```

## 4. What already exists here (the real mechanisms)

atomic-copy is **partly built**: the copy that *is* in the data layer already flows
through a token bag, a transclusion syntax, and a typed-symbol gate. It is currently
three disconnected mechanisms with no shared name — and (§5) the invariant is not yet
enforced, so much copy still bypasses them entirely.

### 4.1 Source — copy as content-slugs

Copy is authored as data, not embedded in templates:

- `data/profile.json` — canonical JSON Resume doc; validated against
  `contract/jsonresume.schema.json` (`build.mjs:58`). Holds `basics.headline`,
  `basics.summary`, `work[].summary`, `work[].highlights[]`, `projects[].description`.
- `data/presentation.json` — render-context "slugs for copy"; validated against
  `contract/presentation.schema.json` (`build.mjs:59`). Holds `intro`, `banner.tagline`,
  `seeking.{focus,detail,cta}`, nav `links`. Its schema already states the layer's
  intent: *"Held to the same string-audit lens as the canonical copy."*

These are the **author-facing atoms**. `build.mjs` shallow-merges them (`build.mjs:60`)
so templates read one `profile` object.

### 4.2 Address + transclusion — the token bag

`build.mjs:107–114` assembles the canonical **token bag**:

```js
const tokens = {
  org, tagline, thesis, brandDesc,   // ← brand/content/strings.json (verbal, org-level)
  name, role, place, headline,       // ← profile / presentation slugs
  email: emailObf,                   // ← obfuscated so transcluded prose stays un-harvestable
  proof: { …label → href },          // ← derived from canonical projects[]
  repo:  { …name → url },            // ← derived from data/site.json highlights
};
```

Posts transclude atoms by address: `posts.mjs:55–60` (`interpolate`) replaces
`{{a.b}}` by resolving the dotted path against the bag — **and throws on an unknown or
non-scalar token**, failing the build (`posts.mjs:58`). The header comment states the
contract: *"a post can't reference a fact that doesn't exist in the source — claims stay
clear and drift-proof."* `build.mjs:566` (the /provenance page) advertises this as a
guarantee: *"an unknown token fails the build, so no claim is unsourced."*

This is the **machine-facing addressing**: copy atoms are referenced by name, and a
dangling reference is a build error — the verbal analogue of an undefined CSS variable.

### 4.3 Type + gate — the typed-symbol catalog + string-audit

`audit-catalog.mjs` derives a **typed-symbol catalog** from the contracts: every
shipped string becomes `{ type, value }` under a stable address —
`hero.headline` (`headline`), `hero.summary` (`body`), `banner.tagline` (`tagline`),
`seeking.cta` (`cta`), `exp.<slug>.b<n>`, `proj.<slug>.desc`, `work.<slug>`. The type
is assigned by `claimOrBody()` (`audit-catalog.mjs:27`): **a digit-bearing string is a
`claim`** (falsifiable → grounding check), narrative copy is `body`. Output:
`data/audit/catalog.json`.

The gate is the **shared, owned** auditor
[`@bounded-systems/string-audit`](https://github.com/bounded-systems/string-audit) —
its own catalog entry describes it as *"typed string symbols, type-scoped audits,
CAS-memoized LLM calls"* (`data/audit/catalog.json` → `work.string-audit`). It is
vendored into `vendor/string-audit/`, pinned by sha256, and run by `scripts/audit.mjs`
(`npm run audit`), which (1) verifies the vendored gate against its hashes, (2)
regenerates the catalog, (3) runs the gate over three curated inputs:

| Input | Role |
|---|---|
| `data/audit/catalog.json` | the typed atoms (generated — do not hand-edit) |
| `data/audit/grounding.json` | fact registry: the only metrics a `claim` may assert |
| `data/audit/attested-claims.json` | allowlist of defensible absolute coverage claims |

Under `--strict` the gate blocks on `error`-level prose findings and any ungrounded
`claim` metric. This is the **verbal counterpart to the design-token drift check** — the
quality gate every atom must pass.

### 4.4 What's missing

The three mechanisms above are not described as one system. There is no single doc, no
shared vocabulary, no schema that says "this is a copy atom", and the author-facing
slugs (`profile.json`/`presentation.json`), the machine address space (the `tokens`
bag), and the typed catalog are three different key shapes that nobody has reconciled.
And — the subject of §5 — **the invariant isn't enforced**: lots of copy never enters
any of these mechanisms at all. atomic-copy is the name, the contract, and the gate that
unify them.

## 5. The current gap: hardcoded strings in `build.mjs`

The invariant (§1) is **violated today**. `build.mjs` renders the pages from template
literals, and many user-facing strings are typed directly into that markup — they never
pass through the token bag, never enter the catalog, and are never seen by `string-audit`.
Representative examples (all in `build.mjs`):

| String (user-facing copy) | Where | Surface |
|---|---|---|
| `Proof —` | `build.mjs:137` | homepage proof line |
| `Background` | `build.mjs:233` | section eyebrow |
| `Education` | `build.mjs:235` | background sub-label |
| `The corpus` | `build.mjs:360` | section eyebrow |
| `repositories` · `public` · `sources` · `languages` | `build.mjs:362–365` | corpus figure labels |
| `Selected work — by tag` | `build.mjs:381` | section eyebrow |
| `Computed from` · `starred work` · `topics kept honest by` | `build.mjs:374–376` | corpus source line |
| `Built with` | `build.mjs:145` | colophon heading |
| `Get in touch` (fallback) | `build.mjs:246` | seeking CTA default |
| `Skills` · `Experience` · `Projects` · `Education` | `build.mjs:536–539` | résumé section headings |
| `Download PDF` | `build.mjs:533` | résumé button |
| `Provenance` · `Provenance chain` · `Claims → evidence` | `build.mjs:558, 562, 579` | provenance page |
| (long lead) *"This site is built deterministically…"* | `build.mjs:559` | provenance lede |
| `Writing` + *"On capability security for agentic systems…"* | `build.mjs:618–619` | blog header |
| `Notes are landing soon.` | `build.mjs:607` | blog empty state |
| `← Home` · `RSS feed` · `all writing` · `Also on:` | `build.mjs:557, 622, 670, 668` | nav / footer |
| `Bounded Systems` | `build.mjs:388` | footer org (literal, not from data) |
| `## Links` · `## Selected work` · `## Writing` | `build.mjs:730, 733, 735` | `llms.txt` section headers |

Every row above is **copy** — a human reads it — yet none is a copy atom. Each is a
violation the migration (§8, M4) must lift into the atomic-copy layer.

**Not violations (leave inline).** The same templates are full of *structural* strings
that are not copy and must stay inline: CSS class names (`bs-text-label eyebrow`,
`proj__name`), `href`/route values (`/resume`, `/feed.xml`), schema keys and JSON-LD
`@type`/`@context`, MIME/`rel` values, date-format month abbreviations used as data
(`MONTHS`, `build.mjs:92`). The gate (§6) must classify by *role* — rendered text node /
human-visible attribute (`alt`, `title`, `aria-label`) = copy; everything else = markup.

## 6. Enforcement: a build-time "no hardcoded strings" gate

To make the invariant real, the gate must **fail the build on any user-facing string
that wasn't sourced from the atomic-copy layer** — the verbal twin of a "no inline hex"
lint. Two complementary moves, smallest first:

1. **Route all rendered text through the bag (`copy(id)`).** Extend the token bag of
   `build.mjs:107–114` to carry UI chrome (section labels, button text, empty states,
   `llms.txt` headers) as atoms, and have templates emit them via a single lookup —
   `${copy("section.corpus")}` rather than the literal `The corpus`, the same way
   colors come from `var(--bs-color-*)` and posts already use `{{…}}` transclusion
   (`posts.mjs:55–60`). An unknown id throws, exactly as `interpolate` does today
   (`posts.mjs:58`) — so a typo'd reference can't ship, and the *only* way to put words
   on the page is to define an atom.
2. **Lint the output for stray text.** Add a checker (run in `scripts/audit.mjs`,
   alongside the vendored gate) that scans the **built HTML in `dist/`** — parse the DOM
   and flag any text node, or human-visible attribute (`alt`/`title`/`aria-label`),
   whose value isn't traceable to a catalog atom. Working over rendered output (not the
   AST of `build.mjs`) keeps it simple and language-agnostic: every word on the page must
   resolve to an atom or the build fails. Allowlist the unavoidable literals
   (punctuation, `&middot;` separators) explicitly, the way `attested-claims.json`
   allowlists defensible claims — *attest, don't suppress*.

With both in place the loop closes: a string can only reach the page by being an atom
(move 1), and the gate proves no string slipped past (move 2). `string-audit` then audits
**all** copy — because, by construction, all copy is now in the catalog it reads.

### 6.3 Coverage status (what the gate enforces today)

Move 1 (`copy(id)`) and move 2 (`scripts/copy-gate.mjs`) are live. `copy(id)` resolves
`data/copy.json` and throws on an unknown id; the gate scans the **built `dist/` HTML**
(body text + the `<head>` page title/description, incl. the og/twitter mirrors) and fails
under `--strict` on any visible word not traceable to an atom. Routes are migrated and
enforced incrementally — never partially in silence:

| Surface | Status |
|---|---|
| `/` (homepage), `/resume` | **enforced** — body + `<head>` title/description |
| `/provenance` | **enforced** — chrome (eyebrow, `prov.title`, `prov.lede`, `prov.chain.eyebrow`/`.lede`, footer) + `<head>`; chain step **names** + seal title are atoms (`prov.step.*`, `prov.seal.title`) |
| `/blog` (index) | **enforced** — eyebrow/`nav.writing`, `blog.lede`, `blog.nav.rss`, nav (`nav.home`/`nav.github`), empty-state + `<head>` |
| `/blog/<slug>` (posts) | **enforced** — eyebrow, syndication label, footer (`post.foot.*`) + `<head>`; post **title/description/tags** come from frontmatter (`contract/posts.schema.json`) |
| `llms.txt` headers | **migrated** — `llms.links`, `llms.work`, `nav.writing` (via `copy()`) |

**Region-exempt** (excluded from the body word-scan — documented, not silent): the
`/provenance` `<ol class="prov-chain">` step **bodies** (long-form provenance narrative
interleaved with build-computed digests/SHAs, links, and the `@@COMMIT@@`/`@@DATE@@` deploy
stamps — not static atoms; their step names *are* atoms, enforced by `copy()`), and each
post's `<div class="post__body e-content">` (prose rendered from the post's markdown — its
own source, not UI chrome).

**Deferred** (not yet migrated/scanned, with reason): `llms.txt` is not word-scanned (its
body carries raw URLs + post slugs that are not copy and would false-positive); the
`<head>` `<link rel="alternate">` `title` attributes — the feed title
`Robert DeLanghe — Writing` (in `head()`, every page) and the `JSON Résumé
(machine-readable)` alternate label — are alternate-resource metadata, not the page
title/description; and the homepage footer literal `Robert DeLanghe · Bounded Systems`
remains inline (word-covered by `name` + the brand org, so the word-level gate can't see
it — the documented §6 limitation). A few atoms carry inline emphasis markup or a literal
HTML entity (`prov.chain.lede`'s `<strong>`/`<em>`, `blog.nav.rss`'s `&nbsp;`,
`prov.step.contracts`/`.gates`' `&middot;`): the atom holds the **exact rendered chrome
string**, kept verbatim so output stays byte-identical.

## 7. Scope options

### Option A — Formalize in-repo: name the layer, lean on string-audit

Document atomic-copy as the existing in-repo layer (this RFC + a short section in
`CLAUDE.md`), keep `profile.json`/`presentation.json` as the source, the `tokens` bag as
the address space, and `string-audit` as the gate. No new package; just a name and a map.

- **Pros:** zero new surface; ships today; honest (it *is* what exists); keeps the pure,
  hermetic build intact.
- **Cons:** the name lives only here; other Bounded sites can't `import` it; the three
  key shapes stay un-reconciled.

### Option B — Extract `bounded-systems/atomic-copy` as a library

Pull the verbal-layer machinery into a sibling of `baobab`: the token-bag builder, the
`{{…}}` transclusion (`posts.mjs:interpolate`), and the catalog generator
(`audit-catalog.mjs`), so any Bounded Systems site consumes one copy engine.

- **Pros:** true sibling to `baobab`; reusable across sites; one place to evolve the
  copy-atom model.
- **Cons:** premature — there is exactly **one** consumer (this repo); extraction now is
  speculative abstraction (against the repo's "ship minimal, independent PRs" norm). The
  gate, `string-audit`, is *already* the shared/owned/vendored piece — the rest is small
  and site-shaped.

### Option C — A copy-atom schema/contract

Add `contract/atomic-copy.schema.json` (peer of the existing `contract/*.schema.json`)
defining a copy atom — `{ address, type, value, grounds? }` with `type ∈ {headline,
body, tagline, cta, claim}` — and validate `data/audit/catalog.json` against it, the
same way `build.mjs` validates `profile.json`/`presentation.json`. Formalizes the
**type system** that today lives implicitly in `audit-catalog.mjs:claimOrBody()`.

- **Pros:** makes the copy-atom type a first-class, versioned contract; consistent with
  the repo's "invalid states unrepresentable at the boundary" discipline; a clean
  artifact to later lift into Option B.
- **Cons:** a little redundant — the catalog is generated, so the schema guards a
  derived file; modest immediate payoff.

## 8. Recommendation

**The goal is the invariant (§1): no hardcoded strings, every string a copy atom,
enforced by the build.** Get there in-repo — **Option A** (name + formalize the layer)
plus **Option C** (a `contract/atomic-copy.schema.json` copy-atom contract) — and defer
**Option B** (extraction) until a second site needs it.

Rationale:

- The invariant is the point; Options A/C are the cheapest path to enforcing it *here*,
  where the layer already half-exists and the gate (`string-audit`) is already wired in.
- The half that exists already works; the missing thing is a **name, a map, and a gate**
  — Option A supplies the first two at zero new surface, and §6 supplies the third.
- Option C is the one piece of *new structure* worth adding immediately: it turns the
  implicit `claimOrBody()` type rule into an explicit `contract/atomic-copy.schema.json`,
  matching how every other boundary in this repo is gated, and gives the enforcement gate
  (§6) a contract to validate against. It's also the clean artifact a future
  `bounded-systems/atomic-copy` would export.
- Option B is correct eventually but **premature at one consumer** — and the genuinely
  shareable part (`string-audit`) is *already* extracted, owned, and vendored. Extract
  the rest when a second site forces it, not before. This honors the repo's minimal-PR,
  no-speculative-abstraction norms.

Net: name the layer, document the map, add the schema, **migrate the inline strings, and
turn the gate on**; revisit extraction when there's a second consumer.

## 9. Milestones

| # | Milestone | Deliverable | Gate |
|---|---|---|---|
| M0 | **Name + invariant** | This RFC (`docs/atomic-copy.md`) merged — states the invariant + map | — |
| M1 | **Canonize the name** | `CLAUDE.md` "The model" section names atomic-copy + the invariant alongside design tokens; cross-link `baobab` | docs only |
| M2 | **Copy-atom contract** (Option C) | `contract/atomic-copy.schema.json`; `audit-catalog.mjs` (or `scripts/audit.mjs`) validates `data/audit/catalog.json` against it | `npm run audit` stays green |
| M3 | **Type honesty** | Audit the `claim` vs `body` split — confirm every digit-bearing atom is `claim` and grounded; document the type vocabulary in the schema `description`s | grounding check |
| M4 | **Migrate inline strings** (the invariant) | Lift every user-facing string enumerated in §5 out of `build.mjs` into the atomic-copy layer (presentation.json-style slugs or a dedicated UI-copy contract); render them via the bag / `copy(id)` (§6.1) | build + audit |
| M5 | **Turn the gate on** (§6.2) | Add the `dist/` text-node checker to `scripts/audit.mjs` and run it under `--strict`; the build **fails on any non-atom user-facing string**. Invariant now enforced. | `npm run audit` blocks |
| M6 | **Reconcile addressing** *(stretch)* | One documented address space across the `tokens` bag and the catalog keys (e.g. `hero.headline` everywhere), so author slug → machine token → catalog symbol is one path | build + audit |
| M7 | **Extract** *(deferred — trigger: 2nd consumer)* | `bounded-systems/atomic-copy`: bag builder + `{{…}}` transclusion + catalog generator + the gate, sibling to `baobab` | re-vendor into both sites |

---

*atomic-copy is to copy what `baobab` is to design: a structure for atoms, with one rule
— no hardcoded values. `baobab` forbids inline colors; atomic-copy forbids inline
strings. This repo already ships some of the atoms; this RFC gives them a name, a type,
a home, and the gate that makes the rule real.*
