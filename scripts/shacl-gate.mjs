#!/usr/bin/env node
// SHACL gate — turns the site's emitted JSON-LD into an ENFORCEABLE contract.
//
// Schema.org alone is flexible guidance. Schema.org + SHACL is an enforceable contract:
// this gate extracts every JSON-LD block from the BUILT HTML, expands it to RDF, and
// validates it against contract/jsonld.shapes.ttl. It FAILS (exit 1) unless the SHACL
// report says conforms: true — printing every violation.
//
// What it does NOT check (separate / manual): that the structured data matches the
// VISIBLE page content, and Google Rich Results eligibility. SHACL is the enforceable
// STRUCTURAL contract; see docs/shacl-jsonld.md.

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import jsonld from "jsonld";
import { Parser as N3Parser } from "n3";
import rdf from "@zazuko/env-node"; // RDF/JS env with .dataset() + clownface (required by rdf-validate-shacl)
import SHACLValidator from "rdf-validate-shacl";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const SHAPES = join(root, "contract", "jsonld.shapes.ttl");

// --- offline schema.org context -------------------------------------------------------
// build.mjs emits `"@context": "https://schema.org"`. Expanding that normally dereferences
// the remote context over the network — non-deterministic and unavailable in hermetic CI.
// We serve a tiny local context instead: @vocab maps every type/property name to a stable
// https://schema.org/ IRI; the three URL-valued properties coerce to IRIs. datePublished is
// left as a plain string literal — matching exactly what the site emits.
const LOCAL_SCHEMA_CONTEXT = {
  "@context": {
    "@vocab": "https://schema.org/",
    url: { "@type": "@id" },
    sameAs: { "@type": "@id" },
    mainEntityOfPage: { "@type": "@id" },
  },
};
const SCHEMA_IRIS = new Set([
  "https://schema.org",
  "https://schema.org/",
  "http://schema.org",
  "http://schema.org/",
]);
const documentLoader = async (urlArg) => {
  if (SCHEMA_IRIS.has(urlArg)) {
    return { contextUrl: null, documentUrl: urlArg, document: LOCAL_SCHEMA_CONTEXT };
  }
  throw new Error(`shacl-gate: refusing network fetch for context <${urlArg}> (offline gate)`);
};

// --- extract JSON-LD blocks from built HTML -------------------------------------------
const LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
function extractJsonLd(html) {
  const out = [];
  let m;
  while ((m = LD_RE.exec(html)) !== null) {
    // build.mjs escapes "<" as "<" before embedding; undo so JSON.parse sees valid text.
    const raw = m[1].replace(/\\u003c/g, "<").trim();
    if (raw) out.push(raw);
  }
  return out;
}

async function listHtmlFiles() {
  const files = [];
  for (const f of ["index.html", "resume.html", "provenance.html", "blog.html"]) {
    if (existsSync(join(dist, f))) files.push(join(dist, f));
  }
  const blogDir = join(dist, "blog");
  if (existsSync(blogDir)) {
    for (const f of await readdir(blogDir)) {
      if (f.endsWith(".html")) files.push(join(blogDir, f));
    }
  }
  return files;
}

// --- jsonld → rdf-ext dataset ---------------------------------------------------------
async function jsonLdToDataset(doc) {
  const nquads = await jsonld.toRDF(doc, {
    format: "application/n-quads",
    documentLoader,
  });
  const quads = new N3Parser({ format: "application/n-quads" }).parse(nquads);
  return rdf.dataset(quads);
}

async function turtleToDataset(ttl) {
  const quads = new N3Parser({ format: "text/turtle" }).parse(ttl);
  return rdf.dataset(quads);
}

// --- run ------------------------------------------------------------------------------
async function main() {
  const shapesTtl = await readFile(SHAPES, "utf8");
  const shapes = await turtleToDataset(shapesTtl);
  const validator = new SHACLValidator(shapes, { factory: rdf });

  const files = await listHtmlFiles();
  let totalBlocks = 0;
  let failed = false;

  for (const file of files) {
    const rel = file.slice(root.length + 1);
    const blocks = extractJsonLd(await readFile(file, "utf8"));
    if (blocks.length === 0) {
      console.log(`  ${rel}: no JSON-LD (ok)`);
      continue;
    }
    totalBlocks += blocks.length;

    // Each block validated against the shapes; aggregate per file for clear reporting.
    const data = rdf.dataset();
    for (const block of blocks) {
      const doc = JSON.parse(block);
      const ds = await jsonLdToDataset(doc);
      for (const q of ds) data.add(q);
    }

    const report = validator.validate(data);
    if (report.conforms) {
      console.log(`  ${rel}: ${blocks.length} block(s) — conforms: true`);
    } else {
      failed = true;
      console.log(`  ${rel}: ${blocks.length} block(s) — conforms: FALSE`);
      for (const r of report.results) {
        const path = r.path?.value ?? "(node)";
        const focus = r.focusNode?.value ?? "(?)";
        const shape = r.sourceShape?.value ?? "";
        const msg = r.message?.map((m) => m.value).join("; ") || r.sourceConstraintComponent?.value || "violation";
        console.log(`      ✗ ${focus}  [${path}]  ${msg}  <${shape}>`);
      }
    }
  }

  console.log("");
  if (failed) {
    console.error(`✗ shacl-gate: JSON-LD does NOT conform to contract/jsonld.shapes.ttl`);
    process.exit(1);
  }
  console.log(`✓ shacl-gate: conforms: true — ${totalBlocks} JSON-LD block(s) across ${files.length} page(s) satisfy the SHACL contract`);
}

main().catch((err) => {
  console.error("✗ shacl-gate: error —", err.message);
  process.exit(1);
});
