# Semantic Merkle — content-addressing lone's tree to bind conformance to provenance

**Status:** proposal / design note. Nothing here is built yet. This records what
[`lone`](https://github.com/bounded-systems/lone) (`jsr:@bounded-systems/lone`) actually
exposes today, the gap between the **conformance** view (`/conformance`) and the
**provenance** view (`/provenance`), and a concrete way to fold both onto one
content-addressed spine.

## The question

lone is *semantic* — it reduces a page to a meaning-tree and reasons over that, not over
raw markup. Does it have a Merkle-tree-like structure we could tie conformance criteria and
provenance evidence to, so a claim like "this `<article>` is WCAG-clean" is itself
content-addressed, signed, and independently verifiable?

## What lone actually exposes today (verified against `@bounded-systems/lone@0.6.0`)

lone's core abstraction for "parts of a website" is the **`SemanticNode`** — a recursive
tree (`src/contracts/semantic_node.ts`):

```ts
type SemanticNode = {
  type: string;                 // tag name, e.g. "article", "h2"
  name?: string;                // accessible name / text
  role?: string;                // ARIA role (native or explicit)
  props: Record<string, unknown>;
  children: SemanticNode[];
};
```

Any subject is canonicalized into this tree before validation:

- `domToSemanticNode` (`src/adapters/dom.ts`) lowers a live DOM subtree to a `SemanticNode`.
- `cdpToSemanticNode` (`src/adapters/cdp.ts`) does the same from a Chrome DevTools
  accessibility tree.
- `validate(subject)` (`src/engine/mod.ts`) lowers, runs nine validators
  (semantic-HTML, nameable, keyboard, ARIA-usage, text-alternatives, screen-reader,
  color-contrast, reader-view, cognitive-budget), and returns `{ findings }`.
- `bless(subject)` wraps `validate` and returns `{ ok, value, findings }`.

Each **`Finding`** (`src/contracts/finding.ts`) is addressed into the tree by **JSONPath**:

```ts
type Finding = {
  code: string;       // LONE_<DOMAIN>_<RULE>
  path: string;       // JSONPath into the SemanticNode tree, e.g. "$.children[2]"
  message: string;
  severity: "error" | "warning" | "info";
};
```

So lone already gives us two of the three things a Merkle tree needs: **a tree**
(`SemanticNode`) and **stable structural addresses into it** (the JSONPath on every finding).

### What lone does *not* have

It has **no hashing, no digest, no content-addressing, no Merkle structure, and no stable
node identity.** Confirmed by scanning all 26 `src/*.ts` modules of `0.6.0`:

- `SemanticNode` carries no `id` and no digest field.
- `validate()` returns *only* `{ findings }`; `bless()` adds only an `ok` flag and the
  unmodified subject. No build computes a node hash.
- The only `digest`-shaped thing in lone is `ContentDigestsEvidence` — the RFC 9530
  `reprDigestHeaders` **boolean the consumer supplies** as external evidence, not anything
  lone derives.
- The CDP adapter's `nodeId` / `backendDOMNodeId` are ephemeral DevTools session handles
  used to rebuild parent/child links during conversion, then discarded — not content
  identities.

## What this repo has today

The conformance and provenance views are computed over **different inputs** and never
reference each other:

- **Conformance** (`vendor/conformance-kit/gates/conformance/`, a zero-dep Node port of
  lone's `standard/`, pinned to `0.4`). `conformance(loneFindings, evidence)` folds lone's
  DOM findings + an external-evidence envelope into a flat list of **criteria**, each tagged
  by `area` (html, accessibility, security, …) and `tier` (1 gating / 2 / 3 / cognitive),
  each with a `met` / `unmet` / `not-assessed` verdict. The findings are *injected*
  (`build.mjs` reads `data/conformance-evidence.json` → `loneFindings`); the report is a
  flat projection. Nothing in it is content-addressed.

- **Provenance** (`vendor/conformance-kit/integrity/`). `gen-sitemanifest.mjs` walks
  `dist/`, writes one `sha256␠␠relpath` line per served **file**, sorted, and rolls the
  whole manifest into a single `siteDigest = sha256(manifest)`. That is a degenerate
  *depth-1 hash list* — leaves + one root — over **file bytes**, not a multi-level Merkle
  tree and not semantic. `gen-provenance.mjs` cosign-signs that root and records its
  **Rekor** log index.

The one genuine Merkle tree in the whole stack is **external**: Sigstore's Rekor append-only
transparency log, into which the whole-site digest is anchored. It commits to opaque bytes
and knows nothing about lone's criteria or the semantic tree.

So today: `/conformance` asserts verdicts derived from the DOM; `/provenance` proves the
integrity of file bytes; the two are decoupled, and neither binds a criterion verdict to the
specific thing it was proven over.

## Proposal: a semantic Merkle tree

Add a per-node digest to lone's `SemanticNode` tree, then hang conformance verdicts and the
provenance root off it. Four steps:

### 1. Merkleize the semantic tree

Define a node digest bottom-up over the **canonicalized** semantic fields (not raw markup):

```
nodeDigest(n) = H( canon(n.type, n.role, n.name, selectProps(n.props))
                   ‖ nodeDigest(child₁) ‖ … ‖ nodeDigest(childₖ) )
```

- `canon(...)` normalizes away volatile, non-semantic noise (formatting whitespace,
  ordering of equivalent attributes, ephemeral ids) so the digest tracks **meaning** — the
  whole reason lone works on `SemanticNode` rather than the DOM.
- `selectProps` keeps only props that affect semantics/accessibility (role, `aria-*`, `alt`,
  `href` presence, etc.) — the same fields lone's validators read.
- The per-page root is `nodeDigest(root)`; every subtree has its own digest, addressable by
  the **JSONPath lone already emits**.

This is the missing third ingredient. lone already has the tree and the addresses; this adds
content identity to each node. It belongs **upstream in lone** (a `digest(node)` helper, or
an opt-in `SemanticNode.digest` field) so every consumer shares one canonicalization — the
digest is only meaningful if everyone computes it the same way.

### 2. Bind each criterion verdict to the subtree digest it was proven over

A lone-evidence criterion result becomes:

```jsonc
{ "criterion": "a11y.aria-author", "subjectPath": "$", "subjectDigest": "sha256:…",
  "status": "met" }
```

The verdict is now an assertion **about that exact subtree hash**. Mutate the subtree and its
digest changes, so the binding no longer matches — a stale "met" can't silently ride along on
changed content. Findings already carry a `path`; resolving that path to its `subjectDigest`
ties every finding to a content-addressed node.

### 3. Roll the per-page semantic roots into the site manifest

Today `site.sha256` has byte leaves only. Add the per-page **semantic roots** (and the
conformance report's own digest) as additional manifest entries, so the manifest root commits
to the *meaning* of each page, not just its bytes. The conformance report becomes a signed
artifact addressed by digest, not a re-derived projection.

### 4. Anchor unchanged

The manifest root is already cosign-signed and Rekor-logged (`gen-provenance.mjs`). With
steps 1–3 the existing pipeline now yields one unbroken chain:

```
SemanticNode digest → page semantic root → site-manifest root → cosign signature → Rekor inclusion proof
```

## What this buys (and what it doesn't)

**Buys:**
- **Subtree-scoped, independently verifiable conformance.** "This `<article>`, digest
  `abc…`, was asserted WCAG-clean in build *X*" with a logarithmic inclusion proof — no need
  to ship or re-hash the whole site.
- **Structural tamper-evidence.** A changed subtree invalidates its digest and every verdict
  bound to it, instead of relying on "re-run the gate to notice."
- **One spine.** `/conformance` and `/provenance` stop being parallel universes; a criterion
  verdict and the signed Rekor entry reference the same digests.

**Doesn't (be honest):**
- For a 7-page static site, the existing flat manifest is already sufficient for *integrity*.
  The semantic-Merkle earns its keep specifically for **claim-scoping** — letting conformance
  assertions be per-subtree and provable — not for byte integrity, which is solved.
- Real Merkle inclusion proofs only matter if someone needs to verify a subtree **without**
  the whole site. If no consumer needs that, steps 1–2 (digest + bind) still add
  tamper-evidence even without step 3's proof machinery.
- Canonicalization is the hard part and the risk surface: two builds that *mean* the same
  must hash the same, or the digests are noise. This is why it must live upstream in lone,
  versioned alongside the standard.

## Next steps

1. Land `digest(node)` + a documented canonicalization in lone upstream (the only piece that
   can't be done in this repo, since the conformance model here is a port pinned to lone).
2. Extend the conformance-kit port so `CriterionResult` carries `subjectPath` +
   `subjectDigest` for lone-evidence criteria.
3. Add per-page semantic roots to `gen-sitemanifest.mjs` and surface them on `/provenance`.
4. Cross-link `/conformance` ↔ `/provenance` by digest.
</content>
</invoke>
