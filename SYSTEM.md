# robertdelanghe.dev — operating manual

One **contract** drives every surface. Edit the contract, push, everything regenerates.
This file is the manual for humans and agents maintaining the system.

## The model

```
data/profile.json   ← identity / copy tokens (bio, experience, skills, seeking, proof, links)
data/site.json      ← the GitHub corpus (stats + curated highlights)   [generated]
        │
        ▼  build.mjs  (pure: no network — safe in nix; validates both contracts)
   dist/index.html   hero · proof · "open to roles" · background · corpus · selected work
   dist/resume.html  print-optimized résumé + "Download PDF" (window.print)
   dist/blog.html    writing (placeholder)
   dist/brand/…      copied from the @bounded-systems/brand submodule
```

- **Contracts** live in `data/`; **schemas** in `contract/*.schema.json`.
- `profile.json` = content tokens ("slugs for copy"), curated by hand (e.g. from a LinkedIn webarchive). Never live-fetched.
- `site.json` = the corpus, produced by `fetch.mjs` (has network), validated against `contract/site.schema.json`.
- Visuals come from the `brand/` git submodule — never hard-code brand values.

## Make a change (the common cases)

| Want to… | Edit | Then |
|---|---|---|
| Change bio / headline / summary | `data/profile.json` | push |
| Add/edit a job (+ résumé bullets) | `data/profile.json` → `experience[]` (`bullets` show on the résumé) | push |
| Change "Open to roles" | `data/profile.json` → `seeking` | push |
| Change proof links | `data/profile.json` → `proof` | push |
| Refresh the GitHub corpus now | `GITHUB_TOKEN=$(gh auth token) GH_USER=bdelanghe ORGS=bounded-systems node fetch.mjs` | commit `data/site.json` |
| Change which repos are highlighted | `PINS` in `fetch.mjs` | re-run fetch |
| Rebuild locally | `npm run build` (or `nix build .#site` for a hermetic build) | — |

A push to `main` is all you normally need: **Cloudflare Workers Builds** runs `npm run build`
and deploys `site` automatically (serves robertdelanghe.dev + www).

## Automation (what runs itself)

- **Deploy** — Workers Builds on every push to `main`. Fallback: `gh workflow run deploy.yml`
  (hermetic Nix → `wrangler deploy`, independent of Cloudflare's Git App).
- **Corpus refresh** — `.github/workflows/refresh.yml` weekly: re-runs `fetch.mjs`, commits
  `data/site.json` → triggers a redeploy.
- **GitHub profile** — `bdelanghe/bdelanghe` is a **handcrafted** README (the synoptic
  daily auto-gen was intentionally retired). Update it by hand. `synoptic-github` remains a
  standalone tool — `validate`/`suggest` still keep repo topics honest.
- **LinkedIn drift** — `profile.json` is canonical; LinkedIn is a downstream copy that
  drifts. `linkedin-check.mjs` (`npm run check:linkedin`) diffs the committed LinkedIn
  export (`data/linkedin/positions.csv`) against `profile.json` and reports title/date
  drift to fix **on LinkedIn**. Intentional divergences live in
  `data/linkedin/accepted-drift.json`. CI runs it advisory-only on PRs that touch
  `profile.json` or `data/linkedin/` (`.github/workflows/linkedin-check.yml`). Refresh the
  export per `data/linkedin/README.md`.

## Determinism / provenance

`build.mjs` is a pure function of the two contracts + the pinned brand submodule, so the
output bytes are reproducible. The résumé "Download PDF" prints the live page, so the PDF
is always in sync — no committed binary to drift.

## Custom domains (Cloudflare)

`site` worker serves `robertdelanghe.dev` + `www` (custom domains attached to the worker).
DNS + zone are on Cloudflare. The Cloudflare MCP plugin can manage Workers/DNS/domains
directly (`/plugin install cloudflare@cloudflare`, OAuth).
