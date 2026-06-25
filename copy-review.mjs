#!/usr/bin/env node
// Agentic copy review: the authored prose in data/profile.json + data/site.json,
// read by Claude and judged against the site's own thesis and voice.
//
// The other gates are deterministic — schemas, tokens, contrast, meta. Prose
// isn't: "this line overclaims", "this drifts off-thesis", "this reads like AI
// filler" are judgement calls a linter can't make. This gate asks a model to
// make them, so the copy that ships is held to the same bar as everything else.
//
// It reviews the *source* copy (what you author), not rendered HTML — findings
// point at the field to edit. Four axes: claim integrity, thesis coherence,
// voice, clarity. Returns structured findings by severity (blocker/suggestion/nit).
//
// Usage:  node copy-review.mjs            report-only (exit 0)  [npm run check:copy]
//         node copy-review.mjs --strict   exit 1 on any blocker-severity finding
//
// Auth: reads ANTHROPIC_API_KEY from the environment. If it's unset (e.g. a fork
// PR with no access to secrets), the review is SKIPPED cleanly (exit 0) — it
// never blocks a contributor who can't run it.
//
// In CI the key must live in the repo's *Actions* secret store
// (Settings → Secrets and variables → Actions) — the Codespaces, Dependabot,
// and Copilot-agent stores are separate and Actions workflows cannot read them.
//
// Dependency-free: Node builtins + global fetch (same as fetch.mjs). One call to
// the Anthropic Messages API; nothing is written.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const strict = process.argv.includes("--strict");
const MODEL = "claude-opus-4-8";

// ---- the thesis the copy is measured against -----------------------------------
// One sentence, kept here so the reviewer judges against the site's actual
// argument rather than a generic "is this good writing" bar.
const THESIS =
  "Bobby is a senior software engineer who ships agent-authored software in " +
  "production and built the capability-security guardrails (signed owners, " +
  "contract-and-validation in CI) that make trusting agents in production possible. " +
  "The work generalises in prx and the bounded-systems libraries (capability-security " +
  "and agent-infrastructure). The throughline is an old instinct — make invalid " +
  "states unrepresentable — applied to agents.";

// ---- golden corpus: severity anchors --------------------------------------------
// A small calibration set so the judge applies a consistent bar run-to-run instead
// of sampling a random nitpick. The PASS examples matter most — they stop the gate
// reflexively flagging defensible metrics and deliberate voice (the failure mode
// that made it flip-flop: soften a real metric, then call the softened version a bluff).
const GOLDEN =
  "CALIBRATION — anchor severity to these examples and apply the same bar every run:\n" +
  "• PASS (do NOT flag): \"Built static-analysis gating that cut critical bugs 20% across a " +
  "20-engineer team.\" A specific, quantified, mechanistically-supported metric is earned " +
  "confidence, not a bluff. Only question a metric if it's implausible for the stated role " +
  "or contradicted elsewhere — never just because it has a number.\n" +
  "• PASS (do NOT flag): \"I build the security layer for agentic systems.\" Declarative, " +
  "on-thesis voice — not marketing fluff.\n" +
  "• SUGGESTION: \"Leveraged cross-functional synergies to drive impactful outcomes.\" " +
  "AI-slop/cliché with no concrete content; rewrite to a specific action + result.\n" +
  "• SUGGESTION: a 35+-word sentence stacking nominalizations — the 30-second reader loses " +
  "the thread; split it.\n" +
  "• NIT: an unexplained domain acronym on first use (e.g. \"P&L\", \"ETL\") a non-specialist " +
  "would stall on — expand it once.\n" +
  "• BLOCKER: \"Scaled the platform to 10M users\" with no role/context to support it, or a " +
  "claim that contradicts another section — the kind of thing an interviewer exposes in one " +
  "question.\n" +
  "Do not escalate a SUGGESTION to a BLOCKER, and do not manufacture a blocker when none " +
  "exists. An empty-findings 'pass' is the correct, common result.";

const SYSTEM =
  "You review the prose on a software engineer's portfolio site (robertdelanghe.dev) with " +
  "two lenses at once: a meticulous senior copy editor, AND a busy technical hiring manager " +
  "skimming it in about 30 seconds. You are tough but fair: most lines are deliberate and " +
  "fine — surface only real problems, and never invent issues to look useful. Judge each " +
  "piece of copy on four axes:\n" +
  "1. CLAIM INTEGRITY — anything unsupported, inflated, or that an interviewer " +
  "could expose as a bluff. This is the highest-stakes axis.\n" +
  "2. THESIS COHERENCE — the site argues one thing (given below). Flag copy that " +
  "drifts off it, dilutes it, or contradicts it.\n" +
  "3. VOICE — declarative, specific, earned confidence. Flag AI-slop and filler: " +
  "generic phrasing, hedging, 'passionate about', resume cliché, marketing fluff. " +
  "(Em-dashes and a distinctive voice are intentional here — do not flag those.)\n" +
  "4. CLARITY — genuinely confusing, convoluted, or jargon-dense lines: would the " +
  "30-second hiring manager lose the thread or hit an unexplained acronym?\n\n" +
  "Severity: 'blocker' = a claim-integrity problem or a thesis contradiction " +
  "(something that should not ship); 'suggestion' = a voice or clarity improvement; " +
  "'nit' = minor polish. If the copy is clean, return verdict 'pass' with an empty " +
  "findings array. Each finding's `location` must name the exact field it refers to.\n\n" +
  GOLDEN;

// Structured-output schema (Opus 4.8). No length/numeric constraints — those are
// unsupported; enum + required + additionalProperties:false are fine.
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["pass", "issues"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["blocker", "suggestion", "nit"] },
          location: { type: "string" },
          issue: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "location", "issue", "fix"],
      },
    },
  },
  required: ["verdict", "findings"],
};

// ---- assemble the copy bundle (authored prose only) ----------------------------
const readJson = async (p) => JSON.parse(await readFile(join(root, p), "utf8"));

function bundle(profile, site, highlightCopy = {}) {
  const out = {
    headline: profile.headline,
    intro: profile.intro,
    summary: profile.summary,
    seeking: profile.seeking && {
      label: profile.seeking.label,
      focus: profile.seeking.focus,
      detail: profile.seeking.detail,
    },
    experience: (profile.experience || []).map((e) => ({
      org: e.org,
      role: e.role,
      what: e.what,
      bullets: e.bullets,
    })),
    // Review the copy that actually ships: apply the editorial overrides
    // (data/highlight-copy.json) that build.mjs applies, not the raw upstream
    // GitHub descriptions in site.json.
    selected_work: (site.highlights || []).map((h) => ({
      name: h.name,
      description: highlightCopy[h.name] ?? h.description,
    })),
  };
  return out;
}

// ---- report --------------------------------------------------------------------
const ICON = { blocker: "🔴", suggestion: "🟡", nit: "⚪" };

function render(result) {
  const { verdict, findings } = result;
  const lines = [];
  lines.push("# Copy review\n");
  if (!findings.length) {
    lines.push(`✓ ${MODEL} found no issues — copy is on-thesis and clean.`);
    return { md: lines.join("\n"), blockers: 0 };
  }
  const order = { blocker: 0, suggestion: 1, nit: 2 };
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = sorted.reduce((m, f) => ((m[f.severity] = (m[f.severity] || 0) + 1), m), {});
  const blockers = counts.blocker || 0;
  lines.push(
    `Verdict: **${verdict}** — ` +
      `🔴 ${blockers} blocker${blockers === 1 ? "" : "s"} · ` +
      `🟡 ${counts.suggestion || 0} suggestion${(counts.suggestion || 0) === 1 ? "" : "s"} · ` +
      `⚪ ${counts.nit || 0} nit${(counts.nit || 0) === 1 ? "" : "s"}\n`,
  );
  for (const f of sorted) {
    lines.push(`### ${ICON[f.severity]} \`${f.location}\``);
    lines.push(`**Issue:** ${f.issue}`);
    lines.push(`**Fix:** ${f.fix}\n`);
  }
  return { md: lines.join("\n"), blockers };
}

// Write a line to the GitHub Actions run summary when present, so skips and
// errors are visible in the PR's checks tab — not buried in raw job logs.
async function summary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  }
}

// ---- the reviewer call ---------------------------------------------------------
// Factored out so the regression harness (copy-review-fixtures.mjs) exercises the
// *exact* prompt + model the gate uses. Returns { result } on success, or
// { skip, raw? } on a recoverable non-result (model refusal / unparseable output).
// Throws on a transport/API error, so the caller decides whether to treat it as a skip.
//
// temperature 0: at the default (1.0) the same copy yields a different verdict each
// run — the gate flip-flops on judgement calls. 0 + the pinned model is the most
// reproducible setting the Anthropic API offers (it has no `seed`). Not bit-for-bit
// deterministic, but it curbs the run-to-run churn.
export async function reviewCopy(copy, apiKey, { temperature = 0 } = {}) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      temperature,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content:
            `THESIS (what the whole site argues):\n${THESIS}\n\n` +
            `Review this copy. Return findings via the schema.\n\n` +
            "```json\n" +
            JSON.stringify(copy, null, 2) +
            "\n```",
        },
      ],
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const resp = await r.json();
  if (resp.stop_reason === "refusal") return { skip: "model declined to review" };
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  try {
    return { result: JSON.parse(text) };
  } catch {
    return { skip: "could not parse model response", raw: text };
  }
}

// ---- main ----------------------------------------------------------------------
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const msg = "copy-review: skipped — ANTHROPIC_API_KEY is not set.";
    console.log(msg);
    await summary(`# Copy review\n\n⚠️ _${msg}_`);
    return 0; // never block a contributor who can't run the review
  }

  const [canonical, presentation, site, highlightCopy] = await Promise.all([
    readJson("data/profile.json"),
    readJson("data/presentation.json"),
    readJson("data/site.json"),
    readJson("data/highlight-copy.json").catch(() => ({})),
  ]);
  // intro + seeking are render-context (presentation.json); merge so the agentic
  // review still judges them alongside the canonical headline/summary/experience.
  const profile = { ...canonical, ...presentation };
  const copy = bundle(profile, site, highlightCopy);

  let out;
  try {
    out = await reviewCopy(copy, apiKey);
  } catch (err) {
    // Infrastructure failure (network, rate limit, API hiccup) must not block a
    // merge — the gate blocks on content problems, not on transient API errors.
    console.error(`copy-review: API call failed — ${err.message}`);
    console.error("copy-review: treating as a skip (no merge block on infra errors).");
    await summary(`# Copy review\n\n⚠️ _API call failed — ${err.message}. Treated as a skip._`);
    return 0;
  }
  if (out.skip) {
    console.error(`copy-review: ${out.skip}; skipping.`);
    if (out.raw) console.error(out.raw.slice(0, 500));
    await summary(`# Copy review\n\n⚠️ _${out.skip}; skipped._`);
    return 0;
  }
  const result = out.result;

  const { md, blockers } = render(result);
  console.log(md);
  await summary(md);
  // When asked (CI), also drop the rendered review to a file so the workflow can
  // post it as a sticky PR comment — findings surface inline, not buried in logs.
  if (process.env.COPY_REVIEW_MD) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(process.env.COPY_REVIEW_MD, md + "\n");
  }

  if (strict && blockers > 0) {
    console.error(`\ncopy-review: ${blockers} blocker(s) under --strict → failing.`);
    return 1;
  }
  return 0;
}

// Run as a CLI only — importing this module (e.g. the fixtures harness) must not
// trigger a review of the live copy.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(strict ? 1 : 0);
    },
  );
}
