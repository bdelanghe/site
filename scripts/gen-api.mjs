#!/usr/bin/env node
// gen-api — emit a static, read-only JSON API + an OpenAPI 3.2 description of it.
//
// Runs AFTER build.mjs (a pure function of the contracts + build.mjs's own dist
// output — no network, no clock). Writes dist/api/v1/:
//   profile.json          — identity card (canonical résumé basics + render-context)
//   posts.json            — writing index (JSON-Feed-shaped)
//   posts/<slug>.json     — one resolved post (metadata + rendered body)
//   corpus.json           — the curated GitHub corpus (data/site.json)
//   conformance.json      — HONEST placeholder for lone's future DOM/a11y report
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
  intro: presentation.intro,
  place: presentation.place,
  seeking: presentation.seeking,
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
    intro: { type: "string" },
    place: { type: "string" },
    seeking: { type: "object", additionalProperties: true },
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
  title: "DOM / a11y conformance report (placeholder)",
  type: "object",
  required: ["status", "generator", "summary", "pages"],
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["not-yet-evaluated", "pass", "fail"] },
    generator: { type: "object", required: ["name", "ran"], additionalProperties: true, properties: { name: { type: "string" }, url: { type: "string" }, ran: { type: "boolean" } } },
    spec: { type: "string" },
    note: { type: "string" },
    summary: { type: "object", required: ["pages", "checks", "passed", "failed"], additionalProperties: false, properties: { pages: { type: "integer" }, checks: { type: "integer" }, passed: { type: "integer" }, failed: { type: "integer" } } },
    pages: { type: "array", items: { type: "object", additionalProperties: true } },
  },
};

// ---- conformance.json — honest placeholder (lone's future output) -----------
const conformance = {
  status: "not-yet-evaluated",
  generator: { name: "lone", url: "https://github.com/bounded-systems/lone", ran: false },
  spec: `${SITE}/provenance`,
  note: "Placeholder. lone blesses every rendered page's DOM (semantic HTML + a11y); this report will carry its per-page conformance results. Shape is stable; values are empty until lone runs in the build.",
  summary: { pages: 0, checks: 0, passed: 0, failed: 0 },
  pages: [],
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
    "/corpus.json": { get: { operationId: "getCorpus", summary: "Curated GitHub corpus", tags: ["corpus"], responses: { 200: jsonResp("#/components/schemas/Corpus") } } },
    "/conformance.json": { get: { operationId: "getConformance", summary: "DOM/a11y conformance (placeholder)", tags: ["provenance"], responses: { 200: jsonResp("#/components/schemas/Conformance") } } },
    "/resume.vc.json": { get: { operationId: "getResumeCredential", summary: "Résumé as a W3C Verifiable Credential 2.0", description: "credentialSubject is the canonical JSON Resume; issuer is did:web:robertdelanghe.dev. The cryptographic proof is an enveloping Sigstore bundle served alongside as resume.vc.json.sigstore.json (keyless, bound to the GitHub Actions OIDC identity).", tags: ["identity"], responses: { 200: jsonResp("#/components/schemas/ResumeCredential") } } },
    "/openapi.json": { get: { operationId: "getOpenapi", summary: "This document", tags: ["meta"], responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object" } } } } } } },
  },
  components: {
    schemas: {
      Profile: embed(profileSchema),
      Post: embed(postSchema),
      PostsIndex: embed(postsIndexSchema),
      Conformance: embed(conformanceSchema),
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
await write("conformance.json", conformance);
// the reused contract schemas, served so the advertised $id URLs resolve
await write(join("schemas", "jsonresume.schema.json"), jsonResumeSchema);
await write(join("schemas", "site.schema.json"), siteSchema);
await write(join("schemas", "posts.schema.json"), postsSchema);
await write(join("schemas", "profile.schema.json"), profileSchema);
await write(join("schemas", "post.schema.json"), postSchema);
await write(join("schemas", "conformance.schema.json"), conformanceSchema);
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
for (const it of items) check(`posts/${it.slug}.json`, postSchema, { ...it, content_html: extractBody(await readFile(join(dist, "blog", `${it.slug}.html`), "utf8")) });

// OpenAPI 3.2 well-formedness via the kit core (version, info, ≥1 path, every
// operation carries responses, every local "#/components/…" $ref resolves).
const oaErrs = validateOpenapi(openapi);
if (oaErrs.length) { console.error("✗ openapi.json is not well-formed OpenAPI 3.2:"); for (const e of oaErrs) console.error(`    ${e}`); process.exit(1); }
// $ref count for the summary line below.
const refs = new Set();
JSON.stringify(openapi, (k, v) => { if (k === "$ref" && typeof v === "string" && v.startsWith("#/")) refs.add(v); return v; });

console.log(`✓ static API: profile · posts(${items.length}) · corpus · conformance + OpenAPI 3.2 (${Object.keys(openapi.paths).length} paths, ${refs.size} schema refs) → dist/api/v1/`);
