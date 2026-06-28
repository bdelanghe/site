#!/usr/bin/env node
// Site config shim → the vendored, hash-pinned conformance-kit identity generator
// (vendor/conformance-kit/generators/gen-identity.mjs). The kit tool is
// site-agnostic; this injects THIS site's identity (domain + source repo for the
// keyless Sigstore cert-identity regexp), the credentialSubject (the built canonical
// JSON Resume at dist/resume.json, validated against contract/jsonresume.schema.json),
// and the VC name/description, then delegates.
//
// Emits dist/.well-known/did.json + dist/api/v1/resume.vc.json. Re-pin: npm run vendor:kit.
process.env.IDENTITY_DOMAIN ??= "robertdelanghe.dev";
process.env.IDENTITY_REPO ??= "bdelanghe/site";
process.env.DIST ??= "dist";
// credentialSubject = dist/resume.json (the kit default), validated against the
// JSON Resume contract so the VC subject can't silently drift from its schema.
process.env.IDENTITY_SUBJECT_SCHEMA ??= "contract/jsonresume.schema.json";
process.env.IDENTITY_VC_NAME ??= "Robert DeLanghe — Résumé";
process.env.IDENTITY_VC_DESCRIPTION ??= "The canonical JSON Resume for Robert DeLanghe, issued as a Verifiable Credential. The cryptographic proof is an enveloping Sigstore bundle served alongside (resume.vc.json.sigstore.json), keyless and bound to the source repo's GitHub Actions OIDC identity.";
await import("../vendor/conformance-kit/generators/gen-identity.mjs");
