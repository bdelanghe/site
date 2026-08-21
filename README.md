# robertdelanghe.dev

A focused software-engineering portfolio for **Robert DeLanghe**. Static HTML/CSS,
no runtime, built on the [`@bdelanghe/brand`][brand] design system — a personal pinning
of [`bounded-systems/baobab`][baobab] (tokens, self-hosted fonts, and the "r+d" mark).

## How it consumes the brand

`build.mjs` resolves the brand two ways: `npm run build`/`npm run dev`/CI install it as
an ordinary (GitHub-sourced) npm dependency at `node_modules/@bdelanghe/brand`; `nix build`
materializes the flake-pinned source directly at `brand/` instead (see `flake.nix`) —
`build.mjs` prefers `brand/` when it's populated so the same code works in both. The page
links its tokens + fonts and never hard-codes brand values:

```html
<link rel="stylesheet" href="brand/css/fonts.css">     <!-- self-hosted woff2 -->
<link rel="stylesheet" href="brand/tokens/tokens.css"> <!-- --bs-* vars + .bs-text-* -->
<link rel="stylesheet" href="brand/css/base.css">
```

## Build & preview

```bash
git clone https://github.com/bdelanghe/site.git
npm install      # installs @bdelanghe/brand from node_modules
npm run dev      # serve at http://localhost:8080
npm run build    # assemble dist/  (prebuild runs the brand token-drift check)
nix build .#site # hermetic build → ./result (nodejs + brand pinned by flake.lock)
```

## Deploy

Hosted on **Cloudflare Workers** (static assets). Deployment is
`.github/workflows/deploy.yml` — a **two-phase, promote-the-artifact pipeline**, not a
push-to-deploy hook:

1. **build** — hermetic `nix build .#site`, then keyless-sign the in-toto/SLSA statement
   and the whole-site manifest via Sigstore/Rekor (no held key) and publish a signed,
   fully-deployable **OCI artifact to GHCR**.
2. **deploy** — the canonical reusable pipeline in
   [`bounded-systems/.github`](https://github.com/bounded-systems/.github) (`site-deploy.yml`):
   pull and **cosign-verify** the artifact, upload an un-served **preview** version,
   cryptographically verify that version's own preview URL, then **promote** to production.

Promotion is gated behind the repo's **`site-promote` Environment (required reviewers)** —
a push to `main` builds and previews automatically, then *waits* for a human to approve
before production routing changes. Promote re-verifies the same artifact rather than
rebuilding, so what reaches prod is byte-identical to what was previewed.

> **Cloudflare Workers Builds must stay disconnected.** If the Builds Git App is attached
> to this repo it deploys in parallel and races this pipeline — bypassing the signing,
> verification, and approval gate entirely. `deploy.yml` says the same in its header.

The worker is named **`site`**; `wrangler.jsonc` must match it (a Worker can't be renamed —
delete and recreate to change it). The custom domain `robertdelanghe.dev` is set in the
Worker's Settings → Domains & Routes; DNS is already in Cloudflare.

`.github/workflows/refresh.yml` re-ingests the GitHub corpus weekly (Mondays 08:17 UTC),
commits `data/site.json`, and then **dispatches `deploy.yml` via the API** — a scheduled
commit does not itself trigger a push-event deploy, so the explicit dispatch is what keeps
the corpus live. `flake.nix` gives the same hermetic build locally (`nix build .#site`) for
reproducible verification.

When bumping the brand, update both `package.json`'s dependency and
`nix flake update brand`.

[brand]: https://github.com/bdelanghe/brand
[baobab]: https://github.com/bounded-systems/baobab
