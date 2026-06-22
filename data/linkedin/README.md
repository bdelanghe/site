# data/linkedin/ — the downstream copy

`data/profile.json` is canonical. LinkedIn is a separate surface that drifts. The
files here are LinkedIn's own export, committed so `linkedin-check.mjs` can diff the
two and tell you what to fix **on LinkedIn**.

## Refresh the export

1. LinkedIn → **Settings & Privacy → Data Privacy → Get a copy of your data**.
2. Pick **Positions** (and optionally **Skills**); request the archive.
3. When it arrives, drop `Positions.csv` here as `positions.csv` (and `Skills.csv`
   as `skills.csv`, if you want skills coverage). Commit.

`positions.csv` columns (LinkedIn's schema): `Company Name, Title, Description,
Location, Started On, Finished On`. Only company / title / dates are checked.

> The committed `positions.csv` was seeded from a profile PDF export (Jun 2026).
> Replace it with the official data-export CSV when convenient — same schema.

## Run the check

```
npm run check:linkedin        # report-only
node linkedin-check.mjs --strict   # exit 1 on unaccepted factual drift
```

CI runs it automatically (`.github/workflows/linkedin-check.yml`, advisory) on PRs
that touch `profile.json` or this folder.

## accepted-drift.json

Intentional divergences (e.g. the contract-era "Integrations Consultant" titles,
which the repo deliberately reframes as engineering work). Listed so they're
classified **accepted** instead of re-flagged. Add an entry only for a deliberate
choice, with a note explaining why.
