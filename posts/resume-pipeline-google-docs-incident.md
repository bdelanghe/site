---
title: How I build my résumé — and how mapping it to Google Docs got my account disabled
type: post
date: 2026-07-04
description: A JSON Resume source of truth renders to a site, a PDF, and a native Google Doc for review. The Google Docs leg's publish cycle looked enough like a bot to get the account behind it disabled.
tags: [agent-infra, contracts, provenance]
target: dev
---
My résumé is not a document I edit. It's a build.

## One canonical source, three renders

`data/profile.json` is a [JSON Resume](https://jsonresume.org) file — `basics`/`work`/`education`/`projects`/`meta` — and it's the only place résumé content gets written. Everything else is generated from it:

- **The site** (`robertdelanghe.dev/resume`) — a static render, plus `/resume.json` as a near-identity emit and `/resume.pdf`.
- **A Google Doc** — native Docs content, for a specific job: giving someone a surface to comment on.
- **A content-addressed manifest** — every résumé "bit" (a summary, a highlight, a project description) gets a stable key (`work.aura.summary`, `projects.prx.description`) and its text is hashed into a CAS store. A merkle root over the whole manifest gets SSH-signed once I've reviewed every changed line through a deterministic prose gate (overclaims, AI-isms, passive voice, readability) plus my own sign-off. Nothing ships until it's both audited and signed.

The point of the pipeline is that "I updated my résumé" is a specific, checkable claim: this exact text, passed this exact gate, signed by this exact key, on this exact date.

## Why a Google Doc at all

The site and the PDF are one-way — good for shipping, useless for feedback. A friend reviewing my résumé needs to leave a comment on a specific line, not email me a diff. Google Docs already solves that problem better than anything I'd build myself, so the pipeline renders into one instead of reimplementing commenting.

The renderer turns the JSON into native Docs API `batchUpdate` requests — paragraph styles, bullets, section rules, links — and tags each section with a **named range** keyed to its JSON path, so a future pass can pull structured suggestions back out of Drive comments instead of just reading prose.

Publishing an existing doc follows a lock cycle: unlock it, replace the whole body, re-lock it (a Drive `contentRestriction`, so nobody — including me — edits the published copy directly instead of through the source). A second, unlocked `workingHead` copy gets created alongside it and shared to a specific reviewer, so live suggestions and comments never get clobbered by the next publish.

There's one Docs API quirk this forces: **`documents.batchUpdate` returns a 403 while the doc has a public "anyone" permission set, even for the owner.** So a public "anyone with the link: commenter" doc — the shape you want for something a friend or a stranger can comment on without a Google account back-and-forth — has to have that permission pulled right before every write and restored right after. Remove → rewrite → restore, every single publish.

## Where it went wrong

That cycle ran on every push that touched `profile.json` — which, across months of wording tweaks, was a lot of small edits. And the identity running it wasn't me: it was a GCP service account, granted **Editor** on my personal Drive file, authenticating over Workload Identity Federation with a broad `https://www.googleapis.com/auth/drive` scope (full read/write over the whole Drive, to touch one file).

That's a Workspace-org pattern — service account, shared file, broad scope — applied to a personal Google account, where it isn't the expected shape at all. Layer the permission-remove/rewrite/restore cycle on top, repeated unattended dozens of times, and you get something that looks a lot like automated abuse to Google's detection systems, even though it's a one-person job-search tool with nothing adversarial about it.

The actual timeline, reconstructed from CI logs after the fact:

- **Jul 1, 01:23** — `Google Drive API 403: "The user's Drive storage quota has been exceeded"` — the first real signal.
- **Jul 1, 01:26** — Fixed by degrading gracefully around the quota error, not by asking why the quota was suddenly gone.
- **Jul 1, 15:01** — Unrelated local test failures, a red herring.
- **Jul 2, 15:58** — `SyntaxError: Unexpected end of JSON input` — Google had started returning empty bodies instead of normal error JSON.
- **Jul 4** — Same `SyntaxError`, still, right up until I actually clicked the public doc link myself and got a plain "you can't access this item, it violates our Terms of Service."

Google's disable notice dates the account "unavailable" from July 1st — the same day the quota error first showed up. Three days of CI failures had a real signal in them; my own error handling just wasn't built to surface it. `client.mjs` assumed every failed response was well-formed `{error: {...}}` JSON. A blocked account doesn't send that — it sends nothing — so the crash read as a flaky bug instead of "this account is gone."

## The fix

I'm not certain the automation *caused* this — this exact error message is a long-running, widely-reported issue that also hits ordinary Google Docs users with no automation involved, so it may be partly or entirely unrelated noise. But the architecture was wrong regardless of whether it's the actual cause, so I'm changing three things:

- **OAuth as the account owner, not a service account.** I authorize the automation myself, once, the way Google expects a personal script to work.
- **`drive.file` scope, not `drive`.** Per-file access to the one document the app itself created — not standing read/write access to my entire Drive.
- **Publish on demand, not on every edit.** The workflow that used to fire on every push to `profile.json` is now `workflow_dispatch`-only. The remove/rewrite/restore cycle still has to happen — that's a real Docs API constraint, not optional churn — but it now happens when I deliberately decide to share an update, not dozens of times a month.

The workflow is disabled outright for now, and the account is still under appeal as I'm publishing this. I don't know yet whether it comes back. I'll follow up once it resolves, either way — including whether the new pipeline actually gets a document to publish to.
