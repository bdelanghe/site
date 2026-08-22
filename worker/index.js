// The site's Worker: static assets, plus one route.
//
// Everything except /mcp falls straight through to the ASSETS binding, byte for
// byte — the same files `nix build .#site` produced, that site.sha256 covers and
// that cosign signed. This script routes; it does not rewrite responses.
//
// ── /mcp — a REMOTE MCP surface, and what it is not ──────────────────────────
//
// @bounded-systems/site-mcp is the VERIFYING surface: it runs on the client's own
// machine, fetches this origin, and checks every byte against the Sigstore-signed
// manifest before handing anything back. The client trusts arithmetic it performed
// itself.
//
// This route cannot offer that, and says so rather than implying otherwise. A
// server that fetches its own origin and reports that the bytes matched its own
// manifest is attesting to itself — `signerSelfAsserted` in bounded-systems/keycard,
// which is proved there to violate both soundness and ambient-blindness. Citing the
// name is a modelling claim, not an inherited proof; keycard's own README is
// emphatic that no theorem there certifies a deployment.
//
// So every result carries `_meta.verification` with `verified: false`, the artifact
// path, the sha-256 this Worker computed, and the URLs of the signed manifest and
// its bundle. A client that cares can check them against Rekor without asking this
// server anything. That is the most a hosted surface can honestly offer: it makes
// independent verification POSSIBLE; it does not perform it.
//
// Zero imports, deliberately. The deploy job pulls the signed OCI artifact and runs
// `wrangler versions upload` with no `npm ci` before it, so anything this file
// imported could not be resolved at bundle time.

const PROTOCOL_VERSION = "2025-06-18";
const SERVER = { name: "robertdelanghe.dev", version: "0.1.0" };
const API = "/api/v1";

// One entry per subject, with the parameter as the generator rule — the same shape
// site-mcp's verbs take, for the same reason: a client loads every tool's schema
// before it calls anything, so a verb per drill-down grows the part paid always to
// shrink the part paid sometimes.
const TOOLS = [
  {
    name: "list_posts",
    description: "List published blog posts (slug, title, summary, tags).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    resolve: () => `${API}/posts.json`,
  },
  {
    name: "get_post",
    description: "Fetch a single blog post by slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Post slug, e.g. agent-authored-code-drift" } },
      required: ["slug"],
      additionalProperties: false,
    },
    resolve: (a) => `${API}/posts/${encodeURIComponent(String(a.slug))}.json`,
  },
  {
    name: "get_conformance",
    description:
      "The site's web-build conformance report. No arguments returns the index — " +
      "totals plus one row per area. Pass `area` for one area's criteria, or `full` " +
      "for every criterion at once.",
    inputSchema: {
      type: "object",
      properties: {
        area: { type: "string", description: "One area, e.g. accessibility. Omit for the index." },
        full: { type: "boolean", description: "Every criterion instead of the index." },
      },
      additionalProperties: false,
    },
    resolve: (a) =>
      a.full
        ? `${API}/conformance.json`
        : a.area
        ? `${API}/conformance/areas/${encodeURIComponent(String(a.area))}.json`
        : `${API}/conformance/index.json`,
  },
  {
    name: "get_corpus",
    description:
      "The curated GitHub corpus. No arguments returns the index — owner, stats, " +
      "highlights and the top ranked topics and languages. Pass `list` for one full " +
      "ranked list, or `full` for the whole corpus.",
    inputSchema: {
      type: "object",
      properties: {
        list: { type: "string", enum: ["topics", "languages", "repos"], description: "One full ranked list. Omit for the index." },
        full: { type: "boolean", description: "The whole corpus instead of the index." },
      },
      additionalProperties: false,
    },
    resolve: (a) =>
      a.full ? `${API}/corpus.json` : a.list ? `${API}/corpus/${a.list}.json` : `${API}/corpus/index.json`,
  },
];

const RESOURCES = [
  ["site://profile", "profile", `${API}/profile.json`, "Identity card: headline, label, links, case studies."],
  ["site://posts", "posts", `${API}/posts.json`, "Index of published writing."],
  ["site://corpus/index", "corpus-index", `${API}/corpus/index.json`, "Corpus aggregate with a link to each full list."],
  ["site://corpus", "corpus", `${API}/corpus.json`, "The whole corpus, unfolded."],
  ["site://conformance/index", "conformance-index", `${API}/conformance/index.json`, "Conformance totals and per-area counts."],
  ["site://conformance", "conformance", `${API}/conformance.json`, "The conformance report, every criterion."],
  ["site://openapi", "openapi", `${API}/openapi.json`, "OpenAPI 3.2 description of this static API."],
];

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// Read one artifact out of the ASSETS binding — the deployed bytes, no egress and
// no chance of looping back through this Worker.
async function readArtifact(env, origin, path) {
  const res = await env.ASSETS.fetch(new Request(new URL(path, origin)));
  if (!res.ok) return { error: `no artifact at ${path} (${res.status})` };
  const bytes = new Uint8Array(await res.arrayBuffer());
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  return { text: new TextDecoder().decode(bytes), path, digest };
}

// The honesty block. `verified: false` is the load-bearing field.
const verification = (origin, path, digest) => ({
  verification: {
    path: path.replace(/^\//, ""),
    sha256: digest,
    verified: false,
    manifest: `${origin}/site.sha256`,
    signature: `${origin}/site.sha256.sigstore.json`,
    note:
      "This surface does not verify what it serves — it would be checking its own " +
      "origin against its own manifest. Check sha256 against the signed manifest " +
      "yourself, or use `npx @bounded-systems/site-mcp`, which verifies on your machine.",
  },
});

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

async function handleRpc(msg, env, origin) {
  const { id, method, params = {} } = msg;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {}, resources: {} },
      serverInfo: SERVER,
      instructions:
        `Read-only access to ${origin}'s static API. This surface does NOT verify ` +
        `the bytes it returns against the site's signed manifest — every result says ` +
        `so in _meta.verification, with the digest and the manifest URL so you can ` +
        `check independently. For verified reads, run @bounded-systems/site-mcp locally.`,
    });
  }
  if (method === "ping") return rpcResult(id, {});

  if (method === "tools/list") {
    return rpcResult(id, {
      tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  }

  if (method === "tools/call") {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${params.name}`);
    let path;
    try {
      path = tool.resolve(params.arguments ?? {});
    } catch {
      return rpcError(id, -32602, "could not resolve arguments to an artifact path");
    }
    const art = await readArtifact(env, origin, path);
    if (art.error) {
      return rpcResult(id, { isError: true, content: [{ type: "text", text: art.error }] });
    }
    return rpcResult(id, {
      content: [{ type: "text", text: art.text }],
      _meta: verification(origin, art.path, art.digest),
    });
  }

  if (method === "resources/list") {
    return rpcResult(id, {
      resources: RESOURCES.map(([uri, name, , description]) => ({
        uri, name, description, mimeType: "application/json",
      })),
    });
  }

  if (method === "resources/read") {
    const row = RESOURCES.find(([uri]) => uri === params.uri);
    if (!row) return rpcError(id, -32602, `unknown resource: ${params.uri}`);
    const art = await readArtifact(env, origin, row[2]);
    if (art.error) return rpcError(id, -32602, art.error);
    return rpcResult(id, {
      contents: [{ uri: row[0], mimeType: "application/json", text: art.text }],
      _meta: verification(origin, art.path, art.digest),
    });
  }

  return rpcError(id, -32601, `unknown method: ${method}`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return env.ASSETS.fetch(request);

    if (request.method !== "POST") {
      // Stateless: no SSE stream to open, so GET has nothing to return.
      return new Response("MCP over Streamable HTTP: POST JSON-RPC to this path.", {
        status: 405,
        headers: { allow: "POST", "content-type": "text/plain; charset=utf-8" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json(rpcError(null, -32700, "parse error"), { status: 400 });
    }

    const origin = url.origin;
    const batch = Array.isArray(body) ? body : [body];
    const replies = [];
    for (const msg of batch) {
      // A notification carries no id and takes no response.
      if (msg == null || msg.id === undefined) continue;
      replies.push(await handleRpc(msg, env, origin));
    }
    if (!replies.length) return new Response(null, { status: 202 });

    return Response.json(Array.isArray(body) ? replies : replies[0], {
      headers: { "cache-control": "no-store" },
    });
  },
};
