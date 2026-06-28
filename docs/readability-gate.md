# Readability gate — a SIGNAL, not a cognitive-load score

`scripts/readability-gate.mjs` (`npm run check:readability`) reports a **readability signal**
over the site's curated copy. **Read this framing first, because it is the point of the
gate:** Flesch-Kincaid and Gunning Fog estimate a US **reading grade** from *surface*
features — sentence length and syllables-per-word. They do **NOT** measure cognitive load,
i.e. how hard the *idea* is to think about. A short sentence full of dense jargon scores
"easy"; a long, perfectly clear sentence scores "hard". So this is an honest **signal**, not
a quality verdict.

## WARN by default

The copy here is hand-curated and signed off (the same string-audit bar as the résumé). So
the gate is **WARN-by-default**: it prints the signal + flags and **exits 0**. It only
**fails (exit 1)** on:

- an **egregious** threshold (a runaway sentence or an absurd grade), or
- being run with `--strict` (every warning escalates to an error).

It runs as a **report** in CI (`.github/workflows/readability.yml`) — green unless egregious
— and is **not** in `prebuild`/`build`. It is deliberately not a blocking build gate.

## Thresholds (documented)

| Signal | WARN | EGREGIOUS (block) |
|---|---|---|
| reading grade (mean of FK + Fog) | > 14 (college) | > 22 |
| sentence length | > 30 words | > 60 words |
| paragraph (atom) length | > 90 words | — |
| passive voice | each occurrence | — |
| unexplained acronym | each occurrence (not in the known/domain set) | — |

Thresholds are deliberately generous: the copy is terse, technical marketing prose, where a
grade in the low-to-mid teens is expected and fine. The numbers are levers, not law.

## Corpus

Prose atoms only (≥ 6 words — a reading-grade formula is meaningless on a two-word button):
`data/profile.json` (headline, summary, work summaries + highlights, project descriptions),
`data/presentation.json` (intro, tagline, seeking focus/detail), and the long-form ledes in
`data/copy.json`. Everything is zero-dep: syllables via a vowel-group heuristic with a
silent-final-`e` correction; sentences via terminal-punctuation splitting.
