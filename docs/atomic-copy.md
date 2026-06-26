# RFC: atomic-copy — the verbal token layer

**Status:** Draft · **Owner:** Robert DeLanghe · **Scope:** robertdelanghe.dev (and the wider Bounded Systems sites)

> One word, "tokens", is doing two jobs. `baobab` owns the **visual** atoms (colors,
> type, space). This RFC names the **verbal** atoms — every shipped string as an
> addressable, typed, audited unit of copy — **atomic-copy**, the counterpart to
> design tokens. It mostly already exists in this repo; this RFC names it and decides
> where it should live.

## 1. Definition

**atomic-copy** is the model in which *all website copy is addressable, typed, and
audited* — the verbal counterpart to design tokens.

| Property | Design tokens (`baobab`/brand) | atomic-copy (this RFC) |
|---|---|---|
| Atom | a visual primitive — `--bs-color-forest`, `--bs-font-mono` | a string — `hero.headline`, `exp.aura.b0` |
| Addressable | CSS custom property | dotted key into a token bag / catalog symbol |
| Typed | token group (color / type / space) | copy type (`headline` · `body` · `tagline` · `cta` · `claim`) |
| Sourced | `brand/tokens/tokens.json` | `data/profile.json` + `data/presentation.json` |
| Gate | drift-check vs `brand/tokens/tokens.css` | `@bounded-systems/string-audit` |

The unit is an **atom**: a single string with a stable address and a declared type.
"Addressable" means a post or template references the atom by name instead of
re-typing the words; "typed" means the auditor knows whether a string is a falsifiable
`claim` (route to grounding) or narrative `body` (prose checks only); "audited" means
every atom passes the same gate before a byte renders.

## 2. The problem it solves: "tokens" is overloaded

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

## 3. What already exists here (the real mechanisms)

atomic-copy is **~80% built**. It is currently three disconnected mechanisms with no
shared name:

### 3.1 Source — copy as content-slugs

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

### 3.2 Address + transclusion — the token bag

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

### 3.3 Type + gate — the typed-symbol catalog + string-audit

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

### 3.4 Gap

The three mechanisms above are not described as one system. There is no single doc, no
shared vocabulary, no schema that says "this is a copy atom", and the author-facing
slugs (`profile.json`/`presentation.json`), the machine address space (the `tokens`
bag), and the typed catalog are three different key shapes that nobody has reconciled.
atomic-copy is the name and the contract that unifies them.

## 4. Scope options

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

## 5. Recommendation

**Adopt Option A now, and fold in Option C as its first concrete deliverable.** Defer
Option B until a second site needs it.

Rationale:

- The layer already exists and works; the missing thing is a **name and a map**, which
  is exactly what costs nothing and unblocks every future conversation. Option A.
- Option C is the one piece of *new structure* worth adding immediately: it turns the
  implicit `claimOrBody()` type rule into an explicit `contract/atomic-copy.schema.json`,
  matching how every other boundary in this repo is gated, and produces the artifact
  (a copy-atom contract) that a future `bounded-systems/atomic-copy` would export.
- Option B is correct eventually but **premature at one consumer** — and the genuinely
  shareable part (`string-audit`) is *already* extracted, owned, and vendored. Extract
  the rest when a second site forces it, not before. This honors the repo's minimal-PR,
  no-speculative-abstraction norms.

Net: name the layer, document the map, add the schema; revisit extraction when there's a
second consumer.

## 6. Milestones

| # | Milestone | Deliverable | Gate |
|---|---|---|---|
| M0 | **Name + map** | This RFC (`docs/atomic-copy.md`) merged | — |
| M1 | **Canonize the name** | `CLAUDE.md` "The model" section names atomic-copy as the verbal layer alongside design tokens; cross-link `baobab` | docs only |
| M2 | **Copy-atom contract** (Option C) | `contract/atomic-copy.schema.json`; `audit-catalog.mjs` (or `scripts/audit.mjs`) validates `data/audit/catalog.json` against it | `npm run audit` stays green |
| M3 | **Type honesty** | Audit the `claim` vs `body` split — confirm every digit-bearing atom is `claim` and grounded; document the type vocabulary in the schema `description`s | grounding check |
| M4 | **Reconcile addressing** *(stretch)* | One documented address space across the `tokens` bag and the catalog keys (e.g. `hero.headline` everywhere), so author slug → machine token → catalog symbol is one path | build + audit |
| M5 | **Extract** *(deferred — trigger: 2nd consumer)* | `bounded-systems/atomic-copy`: bag builder + `{{…}}` transclusion + catalog generator, sibling to `baobab` | re-vendor into both sites |

---

*atomic-copy is to copy what `baobab` is to design: a structure for atoms. This repo
already ships the atoms — this RFC gives them a name, a type, and a home.*
