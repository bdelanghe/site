#!/usr/bin/env node
// gen-api — emit a static, read-only JSON API + an OpenAPI 3.2 description of it.
//
// Runs AFTER build.mjs (a pure function of the contracts + build.mjs's own dist
// output — no network, no clock). Writes dist/api/v1/:
//   profile.json          — identity card (canonical résumé basics + render-context)
//   posts.json            — writing index (JSON-Feed-shaped)
//   posts/<slug>.json     — one resolved post (metadata + rendered body)
//   corpus.json           — the curated GitHub corpus (data/site.json)
//   conformance.json      — the REAL web-build conformance report (written by
//                           build.mjs from lone's conformance() model); re-read here
//                           to advertise + self-check it against its response schema
//   openapi.json          — OpenAPI 3.2 doc; response schemas reuse the repo's
//                           contract/*.schema.json (JSON Schema 2020-12) verbatim
//   schemas/*.json        — the reused contract schemas, served so $id resolves
//
// No server: every endpoint is a static file. The whole tree lives under dist/, so
// it is covered by site.sha256 (gen-sitemanifest) and rides inside the signed OCI
// artifact automatically — provenance for the API comes for free.
//
// Zero new deps — node built-ins + the repo's hand-rolled schema-validate.mjs, which
// also self-checks every emitted document against the schema the OpenAPI doc
// advertises (so the contract can't drift from the bytes). Matches the repo's
// hermetic, no-dependency validator style.
import { readFile, access } from "node:fs/promises";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../vendor/conformance-kit/lib/schema-validate.mjs";
import { writeApiFile, embedSchema as embed, jsonResponse as jsonResp, validateOpenapi } from "../vendor/conformance-kit/generators/openapi.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const SITE = "https://robertdelanghe.dev";
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
// Deterministic byte output (key-sorted, trailing newline) via the kit's writer.
const apiDir = join(dist, "api", "v1");
const write = (rel, obj, opts) => writeApiFile(apiDir, rel, obj, opts);

// ---- inputs: the contracts + build.mjs's own dist output ----------------------
const resume = await readJson(join(dist, "resume.json"));        // built canonical JSON Resume
const presentation = await readJson(join(root, "data", "presentation.json"));
const corpus = await readJson(join(root, "data", "site.json"));  // the GitHub corpus
const feed = (await exists(join(dist, "feed.json"))) ? await readJson(join(dist, "feed.json")) : { items: [] };

const jsonResumeSchema = await readJson(join(root, "contract", "jsonresume.schema.json"));
const siteSchema = await readJson(join(root, "contract", "site.schema.json"));
const postsSchema = await readJson(join(root, "contract", "posts.schema.json"));

// ---- profile.json — identity card -------------------------------------------
const b = resume.basics || {};
const profile = {
  id: `${SITE}/#person`,
  name: b.name,
  label: b.label,
  headline: b.headline,
  summary: b.summary,
  url: b.url || SITE,
  location: b.location,
  profiles: b.profiles || [],
  skills: resume.skills || [],
  deck: presentation.deck,
  now: presentation.now,
  // The authored dossier — the homepage's unit of professional value, exposed to
  // agents/parsers as the same four-answer shape it renders as.
  caseStudies: presentation.caseStudies || [],
  links: presentation.links || [],
  // claim → evidence, the same projects[] the homepage proof line derives from
  proof: (resume.projects || []).map((p) => ({ label: p.name, href: p.url })),
  generatedFrom: ["data/profile.json", "data/presentation.json"],
};
const profileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/profile.schema.json`,
  title: "profile / identity card",
  type: "object",
  required: ["id", "name", "label", "headline", "url", "proof"],
  additionalProperties: false,
  properties: {
    id: { type: "string", format: "uri" },
    name: { type: "string" },
    label: { type: "string" },
    headline: { type: "string" },
    summary: { type: "string" },
    url: { type: "string", format: "uri" },
    location: { type: "object", additionalProperties: true },
    profiles: { type: "array", items: { type: "object", additionalProperties: true } },
    skills: { type: "array", items: { type: "object", additionalProperties: true } },
    deck: { type: "string" },
    now: { type: "object", additionalProperties: true },
    caseStudies: { type: "array", items: { type: "object", additionalProperties: true } },
    links: { type: "array", items: { type: "object", additionalProperties: true } },
    proof: { type: "array", items: { type: "object", required: ["label", "href"], additionalProperties: false, properties: { label: { type: "string" }, href: { type: "string", format: "uri" } } } },
    generatedFrom: { type: "array", items: { type: "string" } },
  },
};

// ---- posts.json + posts/<slug>.json -----------------------------------------
// The resolved body is what build.mjs already rendered (single source of truth):
// extract the e-content div from the per-post page. posts.mjs emits no <div>s, so
// the first </div> closes the body — a safe, structural cut.
const extractBody = (html) => {
  const m = /<div class="post__body e-content">([\s\S]*?)<\/div>/.exec(html);
  return m ? m[1].trim() : "";
};
const slugOf = (url) => basename(new URL(url).pathname);
const items = (feed.items || []).map((it) => ({
  id: it.id, slug: slugOf(it.url), url: it.url, title: it.title,
  summary: it.summary, date_published: it.date_published, tags: it.tags || [],
}));
const postSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/post.schema.json`,
  title: "post (rendered API object)",
  type: "object",
  required: ["id", "slug", "url", "title", "summary", "date_published", "content_html"],
  additionalProperties: false,
  properties: {
    id: { type: "string", format: "uri" },
    slug: { type: "string" },
    url: { type: "string", format: "uri" },
    title: { type: "string" },
    summary: { type: "string" },
    date_published: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    content_html: { type: "string" },
  },
};
const postsIndexSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/posts.index.schema.json`,
  title: "posts index",
  type: "object",
  required: ["title", "home_page_url", "count", "items"],
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    home_page_url: { type: "string", format: "uri" },
    count: { type: "integer" },
    items: { type: "array", items: { $ref: "#/components/schemas/Post" } },
  },
};
const conformanceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/conformance.schema.json`,
  title: "web-build conformance report",
  description: "lone's conformance() projection over this build's evidence (rendered at /conformance). The compact `claim` is emitted only when every tier-1 required criterion is `met`; unsupplied criteria are `not-assessed`, never overclaimed.",
  type: "object",
  required: ["standard", "version", "results", "summary", "areaSummaries", "conformant", "claim"],
  additionalProperties: false,
  properties: {
    standard: { type: "string" },
    version: { type: "string" },
    conformant: { type: "boolean" },
    claim: { type: "string" },
    summary: { type: "object", required: ["met", "unmet", "notAssessed", "total"], additionalProperties: false, properties: { met: { type: "integer" }, unmet: { type: "integer" }, notAssessed: { type: "integer" }, total: { type: "integer" } } },
    areaSummaries: { type: "array", items: { type: "object", required: ["area", "met", "unmet", "notAssessed", "total", "summary"], additionalProperties: false, properties: { area: { type: "string" }, met: { type: "integer" }, unmet: { type: "integer" }, notAssessed: { type: "integer" }, total: { type: "integer" }, summary: { type: "string" } } } },
    results: { type: "array", items: { type: "object", required: ["id", "area", "label", "standard", "target", "level", "evidence", "required", "status", "detail"], additionalProperties: true, properties: { id: { type: "string" }, area: { type: "string" }, label: { type: "string" }, standard: { type: "string" }, target: { type: "string" }, level: { type: "string" }, evidence: { type: "string", enum: ["lone", "external"] }, required: { type: "boolean" }, status: { type: "string", enum: ["met", "unmet", "not-assessed"] }, detail: { type: "string" } } } },
  },
};

// ---- conformance.json — the REAL report build.mjs already wrote --------------
// build.mjs runs lone's conformance() over this build's evidence, writes the typed
// report to dist/api/v1/conformance.json, and renders /conformance from it. gen-api
// re-reads those bytes so the OpenAPI description advertises the exact document the
// site serves, and self-checks it against the response schema below.
const conformance = await readJson(join(dist, "api", "v1", "conformance.json"));

// ---- the fold layer: an index that aggregates, and named drill-downs ---------
//
// The same fold model scripts/fold-load.mjs measures the pages with — c: S → F,
// seed(F), u: seed → [e0, e1, …], p(e) — applied to the API, where the budget is
// not a proxy for anything. A page's fan-out budget stands in for working memory
// and carries every caveat that implies. An MCP client's budget is its context
// window: measurable, in bytes, with no proxy in between.
//
// Two documents here hand over the whole set and are the reason this exists:
//
//   conformance.json  16 KB — and it ALREADY CARRIES ITS OWN FOLD. `summary` and
//                     `areaSummaries` are exactly F; they sat inside the document
//                     while every reader paid for all 37 results to reach them.
//                     Without `results` the same document is 1.7 KB — a 10×
//                     compression that cost nothing to compute because it was
//                     already computed.
//
//   corpus.json       72 KB — of which `interests.topics` is a flat ranked list of
//                     745. `interests` folds its repos already (`shown: 30` of
//                     `count: 229`) and does not fold its topics at all.
//
// So each gets an index — the aggregate, plus a seed per drill-down — and the
// drill-downs are separate documents reached by one step of u. Nothing is lost:
// the unfolded documents stay exactly where they were, at the same URLs. The
// index is an ADDITIONAL entry point, which is what a seed is.
const TOP_N = 12;   // what an index shows before the drill-down takes over

const conformanceAreas = conformance.areaSummaries.map((a) => ({
  ...a,
  href: `${SITE}/api/v1/conformance/areas/${a.area}.json`,
}));
const conformanceIndex = {
  standard: conformance.standard,
  version: conformance.version,
  conformant: conformance.conformant,
  claim: conformance.claim,
  summary: conformance.summary,
  areas: conformanceAreas,
  full: `${SITE}/api/v1/conformance.json`,
};
const conformanceAreaDocs = conformance.areaSummaries.map((a) => [
  a.area,
  { ...a, results: conformance.results.filter((r) => r.area === a.area) },
]);

const ints = corpus.interests ?? {};
const corpusIndex = {
  generatedAt: corpus.generatedAt,
  owner: corpus.owner,
  stats: corpus.stats,
  highlights: corpus.highlights,
  topics: {
    count: (ints.topics ?? []).length,
    top: (ints.topics ?? []).slice(0, TOP_N),
    href: `${SITE}/api/v1/corpus/topics.json`,
  },
  languages: {
    count: (ints.languages ?? []).length,
    top: (ints.languages ?? []).slice(0, TOP_N),
    href: `${SITE}/api/v1/corpus/languages.json`,
  },
  repos: {
    count: ints.count,
    shown: ints.shown,
    href: `${SITE}/api/v1/corpus/repos.json`,
  },
  full: `${SITE}/api/v1/corpus.json`,
};

// One shape for both index documents, because both answer the same question:
// what is here, how much of it, and where does the rest live.
const rankedSchema = (title) => ({
  type: "object",
  required: ["count", "top", "href"],
  additionalProperties: false,
  properties: {
    count: { type: "integer", description: `Total ${title} in the corpus.` },
    top: { type: "array", items: { type: "object", required: ["name", "count"], additionalProperties: false, properties: { name: { type: "string" }, count: { type: "integer" } } } },
    href: { type: "string", format: "uri", description: "The full ranked list." },
  },
});
const conformanceIndexSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/conformance.index.schema.json`,
  title: "conformance index (aggregate + drill-down seeds)",
  description: "The conformance report's own fold: totals, per-area counts, and one href per area. Reach a single area's criteria through its href rather than fetching all of them.",
  type: "object",
  required: ["standard", "version", "conformant", "claim", "summary", "areas", "full"],
  additionalProperties: false,
  properties: {
    standard: { type: "string" },
    version: { type: "string" },
    conformant: { type: "boolean" },
    claim: { type: "string" },
    summary: { type: "object", required: ["met", "unmet", "notAssessed", "total"], additionalProperties: false, properties: { met: { type: "integer" }, unmet: { type: "integer" }, notAssessed: { type: "integer" }, total: { type: "integer" } } },
    areas: { type: "array", items: { type: "object", required: ["area", "met", "unmet", "notAssessed", "total", "summary", "href"], additionalProperties: false, properties: { area: { type: "string" }, met: { type: "integer" }, unmet: { type: "integer" }, notAssessed: { type: "integer" }, total: { type: "integer" }, summary: { type: "string" }, href: { type: "string", format: "uri" } } } },
    full: { type: "string", format: "uri", description: "The unfolded report, unchanged and at its original URL." },
  },
};
const conformanceAreaSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/conformance.area.schema.json`,
  title: "conformance area (one drill-down)",
  type: "object",
  required: ["area", "met", "unmet", "notAssessed", "total", "summary", "results"],
  additionalProperties: false,
  properties: {
    area: { type: "string" },
    met: { type: "integer" },
    unmet: { type: "integer" },
    notAssessed: { type: "integer" },
    total: { type: "integer" },
    summary: { type: "string" },
    results: { type: "array", items: { $ref: "#/components/schemas/Conformance/properties/results/items" } },
  },
};
const corpusIndexSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: `${SITE}/api/v1/schemas/corpus.index.schema.json`,
  title: "corpus index (aggregate + drill-down seeds)",
  description: "The corpus without its long tails: owner, stats, the pinned highlights, and the top ranked topics and languages with an href to each full list.",
  type: "object",
  required: ["generatedAt", "owner", "stats", "topics", "languages", "repos", "full"],
  additionalProperties: false,
  properties: {
    generatedAt: { type: "string" },
    owner: { type: "object", additionalProperties: true },
    stats: { type: "object", additionalProperties: true },
    highlights: { type: "array", items: { type: "object", additionalProperties: true } },
    topics: rankedSchema("topics"),
    languages: rankedSchema("languages"),
    repos: { type: "object", required: ["count", "href"], additionalProperties: false, properties: { count: { type: "integer" }, shown: { type: "integer" }, href: { type: "string", format: "uri" } } },
    full: { type: "string", format: "uri", description: "The unfolded corpus, unchanged and at its original URL." },
  },
};

// ---- the OpenAPI 3.2 document ------------------------------------------------
// Embed the reused contract schemas verbatim (minus the $schema dialect key, which
// the OpenAPI doc declares once via jsonSchemaDialect). Operations $ref these, so
// the description is self-contained; the same schemas are also served as files.
// Strip $schema (the dialect is declared once via jsonSchemaDialect) and $id, so a
// component's internal "#/…" refs resolve against the OpenAPI document root rather
// than rebasing onto the component's own $id. JsonResume re-adds an $id below
// because its draft-04 "#/definitions/…" pointers must resolve within that resource.
const openapi = {
  openapi: "3.2.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "robertdelanghe.dev — static identity API",
    version: "1.0.0",
    summary: "Read-only JSON projection of the site's contracts: profile, writing, the GitHub corpus, and a résumé Verifiable Credential.",
    description: "Static files, no server. Every response is a build artifact under /api/v1, covered by the signed whole-site manifest (site.sha256). Response schemas reuse the repo's contract/*.schema.json (JSON Schema 2020-12).",
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    contact: { name: "Robert DeLanghe", url: SITE },
  },
  servers: [{ url: `${SITE}/api/v1`, description: "production (static)" }],
  paths: {
    "/profile.json": { get: { operationId: "getProfile", summary: "Identity card", tags: ["identity"], responses: { 200: jsonResp("#/components/schemas/Profile") } } },
    "/posts.json": { get: { operationId: "listPosts", summary: "Writing index", tags: ["writing"], responses: { 200: jsonResp("#/components/schemas/PostsIndex") } } },
    "/posts/{slug}.json": { get: { operationId: "getPost", summary: "One resolved post", tags: ["writing"], parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }], responses: { 200: jsonResp("#/components/schemas/Post"), 404: { description: "No such post" } } } },
    "/corpus.json": { get: { operationId: "getCorpus", summary: "Curated GitHub corpus", description: "The whole corpus, unfolded. Prefer /corpus/index.json unless you need the long tails.", tags: ["corpus"], responses: { 200: jsonResp("#/components/schemas/Corpus") } } },
    "/corpus/index.json": { get: { operationId: "getCorpusIndex", summary: "Corpus index — aggregate + drill-down seeds", description: "Owner, stats, highlights, and the top ranked topics and languages, each with an href to its full list. The entry point: fetch this first and drill down, rather than pulling the whole corpus.", tags: ["corpus"], responses: { 200: jsonResp("#/components/schemas/CorpusIndex") } } },
    "/corpus/topics.json": { get: { operationId: "listCorpusTopics", summary: "Every corpus topic, ranked", tags: ["corpus"], responses: { 200: jsonResp("#/components/schemas/RankedList") } } },
    "/corpus/languages.json": { get: { operationId: "listCorpusLanguages", summary: "Every corpus language, ranked", tags: ["corpus"], responses: { 200: jsonResp("#/components/schemas/RankedList") } } },
    "/corpus/repos.json": { get: { operationId: "listCorpusRepos", summary: "The corpus repositories shown", tags: ["corpus"], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object" } } } } } } },
    "/conformance.json": { get: { operationId: "getConformance", summary: "Web-build conformance report", description: "lone's conformance() projection over this build's evidence (rendered at /conformance). The strong claim is emitted only when every tier-1 required criterion is met; unsupplied criteria are not-assessed. Prefer /conformance/index.json unless you need every criterion.", tags: ["provenance"], responses: { 200: jsonResp("#/components/schemas/Conformance") } } },
    "/conformance/index.json": { get: { operationId: "getConformanceIndex", summary: "Conformance index — totals, per-area counts, drill-down seeds", description: "The report's own fold, which it already computed: totals plus one row per area with an href. An agent asking how one area is doing fetches that area, not all 37 criteria.", tags: ["provenance"], responses: { 200: jsonResp("#/components/schemas/ConformanceIndex") } } },
    "/conformance/areas/{area}.json": { get: { operationId: "getConformanceArea", summary: "One conformance area's criteria", tags: ["provenance"], parameters: [{ name: "area", in: "path", required: true, schema: { type: "string" } }], responses: { 200: jsonResp("#/components/schemas/ConformanceArea"), 404: { description: "No such area" } } } },
    "/resume.vc.json": { get: { operationId: "getResumeCredential", summary: "Résumé as a W3C Verifiable Credential 2.0", description: "credentialSubject is the canonical JSON Resume; issuer is did:web:robertdelanghe.dev. The cryptographic proof is an enveloping Sigstore bundle served alongside as resume.vc.json.sigstore.json (keyless, bound to the GitHub Actions OIDC identity).", tags: ["identity"], responses: { 200: jsonResp("#/components/schemas/ResumeCredential") } } },
    "/openapi.json": { get: { operationId: "getOpenapi", summary: "This document", tags: ["meta"], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object" } } } } } } },
  },
  components: {
    schemas: {
      Profile: embed(profileSchema),
      Post: embed(postSchema),
      PostsIndex: embed(postsIndexSchema),
      Conformance: embed(conformanceSchema),
      ConformanceIndex: embed(conformanceIndexSchema),
      ConformanceArea: embed(conformanceAreaSchema),
      CorpusIndex: embed(corpusIndexSchema),
      RankedList: { type: "object", required: ["count", "items"], additionalProperties: false, properties: { count: { type: "integer" }, items: { type: "array", items: { type: "object", required: ["name", "count"], additionalProperties: false, properties: { name: { type: "string" }, count: { type: "integer" } } } } } },
      // Keep an $id so this resource's own JSON-pointer refs (e.g. the draft-04
      // "#/definitions/iso8601") resolve WITHIN the embedded schema, not against the
      // OpenAPI document root — the correct OpenAPI 3.1+ bundled-schema behavior.
      JsonResume: { ...embed(jsonResumeSchema), $id: `${SITE}/api/v1/schemas/jsonresume.schema.json` },
      Corpus: embed(siteSchema),
      PostFrontmatter: embed(postsSchema),
      ResumeCredential: {
        type: "object",
        required: ["@context", "type", "issuer", "credentialSubject"],
        properties: {
          "@context": { type: "array", items: { type: "string" } },
          id: { type: "string", format: "uri" },
          type: { type: "array", items: { type: "string" } },
          issuer: { type: "string" },
          validFrom: { type: "string" },
          credentialSubject: { $ref: "#/components/schemas/JsonResume" },
        },
      },
    },
  },
};

// ---- write everything --------------------------------------------------------
await write("profile.json", profile);
await write("posts.json", { title: `${profile.name} — Writing`, home_page_url: `${SITE}/blog`, count: items.length, items });
for (const it of items) {
  const html = await readFile(join(dist, "blog", `${it.slug}.html`), "utf8");
  await write(join("posts", `${it.slug}.json`), { ...it, content_html: extractBody(html) });
}
await write("corpus.json", corpus);
// the fold layer — indexes and drill-downs, alongside the unfolded originals
await write(join("conformance", "index.json"), conformanceIndex);
for (const [area, doc] of conformanceAreaDocs) await write(join("conformance", "areas", `${area}.json`), doc);
await write(join("corpus", "index.json"), corpusIndex);
await write(join("corpus", "topics.json"), { count: (ints.topics ?? []).length, items: ints.topics ?? [] });
await write(join("corpus", "languages.json"), { count: (ints.languages ?? []).length, items: ints.languages ?? [] });
await write(join("corpus", "repos.json"), { count: ints.count, shown: ints.shown, items: ints.items ?? [] });
// conformance.json is written by build.mjs (the REAL report) — not re-emitted here.
// the reused contract schemas, served so the advertised $id URLs resolve
await write(join("schemas", "jsonresume.schema.json"), jsonResumeSchema);
await write(join("schemas", "site.schema.json"), siteSchema);
await write(join("schemas", "posts.schema.json"), postsSchema);
await write(join("schemas", "profile.schema.json"), profileSchema);
await write(join("schemas", "post.schema.json"), postSchema);
await write(join("schemas", "conformance.schema.json"), conformanceSchema);
await write(join("schemas", "conformance.index.schema.json"), conformanceIndexSchema);
await write(join("schemas", "conformance.area.schema.json"), conformanceAreaSchema);
await write(join("schemas", "corpus.index.schema.json"), corpusIndexSchema);
// OpenAPI doc — emitted in declaration order (not key-sorted) so it reads naturally
await write("openapi.json", openapi, { sort: false });

// ---- self-checks: the emitted bytes MUST validate against the advertised schema
const check = (label, schema, data) => {
  const errs = validateSchema(schema, data);
  if (errs.length) { console.error(`✗ ${label} fails its own OpenAPI response schema:`); for (const e of errs) console.error(`    ${e}`); process.exit(1); }
};
check("profile.json", profileSchema, profile);
check("corpus.json", siteSchema, corpus);
check("conformance.json", conformanceSchema, conformance);
check("conformance/index.json", conformanceIndexSchema, conformanceIndex);
check("corpus/index.json", corpusIndexSchema, corpusIndex);
for (const it of items) check(`posts/${it.slug}.json`, postSchema, { ...it, content_html: extractBody(await readFile(join(dist, "blog", `${it.slug}.html`), "utf8")) });

// OpenAPI 3.2 well-formedness via the kit core (version, info, ≥1 path, every
// operation carries responses, every local "#/components/…" $ref resolves).
const oaErrs = validateOpenapi(openapi);
if (oaErrs.length) { console.error("✗ openapi.json is not well-formed OpenAPI 3.2:"); for (const e of oaErrs) console.error(`    ${e}`); process.exit(1); }
// $ref count for the summary line below.
const refs = new Set();
JSON.stringify(openapi, (k, v) => { if (k === "$ref" && typeof v === "string" && v.startsWith("#/")) refs.add(v); return v; });

console.log(`✓ static API: profile · posts(${items.length}) · corpus · conformance + OpenAPI 3.2 (${Object.keys(openapi.paths).length} paths, ${refs.size} schema refs) → dist/api/v1/`);
console.log(`  fold layer: conformance/index.json + ${conformanceAreaDocs.length} area(s) · corpus/index.json + topics/languages/repos`);
