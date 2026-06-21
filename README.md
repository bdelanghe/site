# robertdelanghe.dev

A focused software-engineering portfolio for **Robert DeLanghe**. Static HTML/CSS,
no runtime, built on the [`@bounded-systems/brand`][brand] design system (fonts +
tokens only — no product mark).

## How it consumes the brand

`brand/` is a git **submodule** pinned to a commit of [`bounded-systems/brand`][brand];
the page links its tokens + fonts and never hard-codes brand values:

```html
<link rel="stylesheet" href="brand/css/fonts.css">     <!-- self-hosted woff2 -->
<link rel="stylesheet" href="brand/tokens/tokens.css"> <!-- --bs-* vars + .bs-text-* -->
<link rel="stylesheet" href="brand/css/base.css">
```

## Build & preview

```bash
git clone --recurse-submodules https://github.com/bdelanghe/site.git
npm run dev      # serve at http://localhost:8080
npm run build    # assemble dist/  (prebuild runs the brand token-drift check)
nix build .#site # hermetic build → ./result (nodejs + brand pinned by flake.lock)
```

## Deploy

Hosted on **Cloudflare Workers** (static assets). Deploy is a hermetic Nix build
run from GitHub Actions (`.github/workflows/deploy.yml`): `nix build .#site` on every
push/PR, `wrangler deploy` on `main`. `wrangler` comes from nixpkgs (pinned by
`flake.lock`), so the deployed bytes are reproducible.

Requires repo secret **`CLOUDFLARE_API_TOKEN`** (an "Edit Cloudflare Workers"
token). After the first deploy, add the custom domain `robertdelanghe.dev` to the
Worker (Settings → Domains & Routes); DNS is already in Cloudflare.

> This is a **personal-account** repo, so it uses its **own** repo secret — the
> `bounded-systems` org secret does not apply here.

When bumping the brand, update both the submodule and `nix flake update brand`.

[brand]: https://github.com/bounded-systems/brand
