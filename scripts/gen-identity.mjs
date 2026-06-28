#!/usr/bin/env node
// gen-identity — emit a did:web identity + the résumé as a Verifiable Credential.
//
// Runs AFTER build.mjs (pure: a function of the built canonical résumé + the
// contract; no network, no clock). Writes:
//   dist/.well-known/did.json     — minimal did:web:robertdelanghe.dev document
//   dist/api/v1/resume.vc.json    — the résumé as a W3C VC 2.0; credentialSubject
//                                   is the canonical JSON Resume, issuer is the did
//
// Keyless by design, matching the rest of the site's provenance. There is no held
// signing key: the VC's proof is an ENVELOPING Sigstore bundle minted in CI
// (cosign sign-blob → Fulcio cert from the GitHub Actions OIDC identity → Rekor),
// served alongside as dist/api/v1/resume.vc.json.sigstore.json. So the did:web
// document advertises the Sigstore verification path as a service rather than a
// static public key — the verifier checks a transparency-logged identity, not a
// key we have to guard. Both files are covered by site.sha256 (in dist/).
//
// Zero new deps — node built-ins + the repo's hand-rolled schema-validate.mjs,
// which confirms credentialSubject still satisfies contract/jsonresume.schema.json.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSchema } from "../schema-validate.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const DOMAIN = "robertdelanghe.dev";
const SITE = `https://${DOMAIN}`;
const DID = `did:web:${DOMAIN}`;
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));
const writeJson = async (p, obj) => { await mkdir(dirname(p), { recursive: true }); await writeFile(p, JSON.stringify(obj, null, 2) + "\n"); };

const resume = await readJson(join(dist, "resume.json"));      // built canonical JSON Resume
const jsonResumeSchema = await readJson(join(root, "contract", "jsonresume.schema.json"));

// ---- did:web document --------------------------------------------------------
// Minimal + honest: no verificationMethod, because there is no held key. The
// assertion path is keyless Sigstore (Fulcio/Rekor), surfaced as a service so a
// verifier knows exactly how to check a credential this DID issues.
const did = {
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/suites/jws-2020/v1",
  ],
  id: DID,
  controller: DID,
  alsoKnownAs: [SITE, `${SITE}/`],
  service: [
    {
      id: `${DID}#resume`,
      type: "VerifiableCredentialService",
      serviceEndpoint: `${SITE}/api/v1/resume.vc.json`,
    },
    {
      id: `${DID}#profile`,
      type: "LinkedDomains",
      serviceEndpoint: SITE,
    },
    {
      // How to verify any credential this DID issues: keyless Sigstore, bound to the
      // GitHub Actions OIDC identity of the source repo, logged in public Rekor.
      id: `${DID}#sigstore`,
      type: "SigstoreKeylessVerification",
      serviceEndpoint: {
        oidcIssuer: "https://token.actions.githubusercontent.com",
        certificateIdentityRegexp: "^https://github.com/bdelanghe/site/",
        transparencyLog: "https://rekor.sigstore.dev",
        note: "Credentials are signed with an enveloping Sigstore bundle (e.g. resume.vc.json.sigstore.json), not an embedded key proof.",
      },
    },
  ],
};

// ---- résumé as a Verifiable Credential 2.0 ----------------------------------
// credentialSubject is the canonical JSON Resume VERBATIM, so it keeps satisfying
// contract/jsonresume.schema.json (additionalProperties:false). The subject is
// identified by basics.url; the VC's own id is its served URL. validFrom is the
// résumé's lastModified (a content fact), never a wall clock — keeps it deterministic.
const vc = {
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
  ],
  id: `${SITE}/api/v1/resume.vc.json`,
  type: ["VerifiableCredential"],
  issuer: DID,
  ...(resume.meta?.lastModified ? { validFrom: resume.meta.lastModified } : {}),
  name: "Robert DeLanghe — Résumé",
  description: "The canonical JSON Resume for Robert DeLanghe, issued as a Verifiable Credential. The cryptographic proof is an enveloping Sigstore bundle served alongside (resume.vc.json.sigstore.json), keyless and bound to the source repo's GitHub Actions OIDC identity.",
  credentialSubject: resume,
};

await writeJson(join(dist, ".well-known", "did.json"), did);
await writeJson(join(dist, "api", "v1", "resume.vc.json"), vc);

// ---- self-checks -------------------------------------------------------------
const errs = validateSchema(jsonResumeSchema, vc.credentialSubject);
if (errs.length) {
  console.error("✗ VC credentialSubject no longer satisfies contract/jsonresume.schema.json:");
  for (const e of errs) console.error(`    ${e}`);
  process.exit(1);
}
// VC 2.0 minimum: the v2 context first, a type that includes VerifiableCredential,
// an issuer, and a credentialSubject.
const vcErrs = [];
if (vc["@context"]?.[0] !== "https://www.w3.org/ns/credentials/v2") vcErrs.push("missing/!first VC 2.0 @context");
if (!Array.isArray(vc.type) || !vc.type.includes("VerifiableCredential")) vcErrs.push("type must include VerifiableCredential");
if (!vc.issuer) vcErrs.push("missing issuer");
if (!vc.credentialSubject) vcErrs.push("missing credentialSubject");
if (did.id !== DID) vcErrs.push("did id mismatch");
if (vcErrs.length) { console.error("✗ identity documents malformed:"); for (const e of vcErrs) console.error(`    ${e}`); process.exit(1); }

console.log(`✓ identity: ${DID} → dist/.well-known/did.json · résumé VC 2.0 → dist/api/v1/resume.vc.json (keyless-signed in CI)`);
