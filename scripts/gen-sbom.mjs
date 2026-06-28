#!/usr/bin/env node
// gen-sbom — emit a deterministic SPDX 2.3 SBOM for the WHOLE supply chain that
// the build pulls from, the piece the in-toto/SLSA statement does NOT enumerate.
//
// gen-attestation.mjs records the build INPUTS (data/*.json, brand tokens/content/
// css, the brand git rev, the source commit) as content-addressed materials, but
// it never lists the npm packages or the Nix toolchain. This fills that gap: it
// reads the committed lockfiles (the single source of truth) and emits one
// SPDX-2.3 JSON to dist/sbom.spdx.json. Each package carries a versionInfo, a
// downloadLocation, and a checksum + purl externalRef:
//   • npm packages  — from package-lock.json + the vendored tenant lockfiles;
//                     integrity hash (base64 SRI) decoded to a hex SPDX checksum,
//                     downloadLocation = the resolved registry tarball.
//   • Nix inputs    — from flake.lock (nixpkgs + the brand submodule); narHash
//                     (sha256 SRI) decoded to a hex SPDX SHA256 checksum, rev pinned
//                     via a pkg:github purl + a git+https downloadLocation.
//
// Pure + deterministic: a function of the lockfiles only (no network, no clock —
// the creation timestamp is derived from flake.lock's newest lastModified, output
// is sorted, the namespace is content-derived). Runs BEFORE gen-sitemanifest.mjs so
// the SBOM is covered by site.sha256, and is added as an in-toto subject by
// gen-attestation.mjs. Zero new deps — node built-ins only, matching the repo's
// hermetic, hand-rolled validator style.
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

// SPDXID must be [a-zA-Z0-9.-]; map everything else to '-' so @scope/name@1.2.3
// becomes a legal, collision-resistant element id.
const spdxId = (s) => "SPDXRef-Package-" + s.replace(/[^a-zA-Z0-9.-]/g, "-");
// SPDX checksum algorithm name from an SRI prefix (sha512-… / sha256-… / sha1-…).
const SRI_ALG = { sha512: "SHA512", sha384: "SHA384", sha256: "SHA256", sha1: "SHA1" };
// Decode an SRI hash (alg-<base64>) → { algorithm, checksumValue } in lowercase hex,
// the only checksum form SPDX accepts. Returns null for anything unrecognised.
const sriToChecksum = (sri) => {
  if (typeof sri !== "string" || !sri.includes("-")) return null;
  const [alg, b64] = [sri.slice(0, sri.indexOf("-")), sri.slice(sri.indexOf("-") + 1)];
  const algorithm = SRI_ALG[alg];
  if (!algorithm || !b64) return null;
  return { algorithm, checksumValue: Buffer.from(b64, "base64").toString("hex") };
};

// Collect every resolved npm package across the root lockfile + the vendored tenant
// lockfiles, keyed name@version (deduped — the same dep pinned identically anywhere
// is one SBOM entry). lockfileVersion 3: packages[<path>] with version/resolved/integrity.
async function collectNpm(lockPaths) {
  const pkgs = new Map();
  for (const lp of lockPaths) {
    if (!(await exists(join(root, lp)))) continue;
    const lock = await readJson(join(root, lp));
    for (const [key, p] of Object.entries(lock.packages || {})) {
      if (!key.startsWith("node_modules/")) continue;   // skip the project root ("")
      if (!p.version || !p.resolved) continue;          // skip links/workspaces
      const name = key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
      const id = `${name}@${p.version}`;
      if (pkgs.has(id)) continue;
      pkgs.set(id, {
        kind: "npm",
        name,
        versionInfo: p.version,
        downloadLocation: p.resolved,
        purl: `pkg:npm/${name}@${p.version}`,
        checksum: sriToChecksum(p.integrity),
        license: typeof p.license === "string" ? p.license : null,
      });
    }
  }
  return [...pkgs.values()];
}

// Collect the Nix flake inputs (nixpkgs + the brand submodule). Each is pinned by a
// commit rev + narHash; narHash is an sha256 SRI we decode to a hex SPDX checksum.
function collectNix(flakeLock) {
  const out = [];
  for (const [nodeName, node] of Object.entries(flakeLock.nodes || {})) {
    if (nodeName === "root") continue;
    const lk = node.locked;
    if (!lk || !lk.rev) continue;
    const name = lk.repo ? `${lk.owner}/${lk.repo}` : nodeName;
    const downloadLocation = lk.type === "github"
      ? `git+https://github.com/${lk.owner}/${lk.repo}@${lk.rev}`
      : `git+https://${lk.owner || ""}/${lk.repo || nodeName}@${lk.rev}`;
    out.push({
      kind: "nix",
      node: nodeName,
      name,
      versionInfo: lk.rev,
      downloadLocation,
      purl: `pkg:github/${lk.owner}/${lk.repo}@${lk.rev}`,
      checksum: sriToChecksum(lk.narHash),
      rev: lk.rev,
      lastModified: lk.lastModified || 0,
      license: null,
    });
  }
  return out;
}

const flakeLock = (await exists(join(root, "flake.lock"))) ? await readJson(join(root, "flake.lock")) : { nodes: {} };
const npm = await collectNpm([
  "package-lock.json",
  "vendor/integrity/verify/package-lock.json",
  "vendor/integrity/structure-audit/package-lock.json",
]);
const nix = collectNix(flakeLock);

// Deterministic order: kind (nix before npm) then name then version.
const all = [...nix, ...npm].sort((a, b) =>
  (a.kind === b.kind ? 0 : a.kind === "nix" ? -1 : 1) ||
  a.name.localeCompare(b.name) || a.versionInfo.localeCompare(b.versionInfo));

const packages = all.map((p) => {
  const externalRefs = [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: p.purl }];
  return {
    name: p.name,
    SPDXID: spdxId(`${p.name}@${p.versionInfo}`),
    versionInfo: p.versionInfo,
    downloadLocation: p.downloadLocation,
    filesAnalyzed: false,
    licenseConcluded: "NOASSERTION",
    licenseDeclared: p.license || "NOASSERTION",
    copyrightText: "NOASSERTION",
    ...(p.checksum ? { checksums: [p.checksum] } : {}),
    externalRefs,
  };
});

// Deterministic, content-derived bits: no wall clock. The creation date is the newest
// flake.lock lastModified (a pure function of the pinned inputs); the namespace is a
// digest of the package set so identical lockfiles → identical document, byte-for-byte.
const newest = Math.max(0, ...nix.map((p) => p.lastModified));
const created = new Date(newest * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const fingerprint = createHash("sha256").update(JSON.stringify(packages)).digest("hex");

const doc = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "robertdelanghe.dev-sbom",
  documentNamespace: `https://robertdelanghe.dev/sbom/${fingerprint}`,
  creationInfo: {
    created,
    creators: ["Tool: gen-sbom.mjs", "Organization: Bounded Systems"],
  },
  packages,
  relationships: packages.map((p) => ({
    spdxElementId: "SPDXRef-DOCUMENT",
    relationshipType: "DESCRIBES",
    relatedSpdxElement: p.SPDXID,
  })),
};

await writeFile(join(dist, "sbom.spdx.json"), JSON.stringify(doc, null, 2) + "\n");
console.log(`✓ SBOM: ${packages.length} packages (${nix.length} Nix + ${npm.length} npm) → dist/sbom.spdx.json (SPDX-2.3, signed in CI)`);
