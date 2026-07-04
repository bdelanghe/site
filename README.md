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

Hosted on **Cloudflare Workers** (static assets), deployed by **Cloudflare Workers
Builds** connected to this repo: on every push to `main` it runs `npm run build`
(which runs the brand token-drift check first) then `npx wrangler deploy`. No secret
to manage — Builds uses its own token. The worker is named **`site`**; `wrangler.jsonc`
must match it (a Worker can't be renamed — delete + recreate if you ever want a
different name). Add the custom domain `robertdelanghe.dev` in the Worker's
Settings → Domains & Routes; DNS is already in Cloudflare.

`.github/workflows/refresh.yml` refreshes `data/site.json` weekly (commit → Builds
redeploys), so the corpus stays current. `flake.nix` still gives a hermetic local
build (`nix build .#site`) for reproducible verification.

When bumping the brand, update both `package.json`'s dependency and
`nix flake update brand`.

[brand]: https://github.com/bdelanghe/brand
[baobab]: https://github.com/bounded-systems/baobab
