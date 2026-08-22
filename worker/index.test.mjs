// The Worker is a pure (Request, env) → Response, so it tests offline: stub the
// ASSETS binding with the real built dist/ and drive it with actual JSON-RPC.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import worker from "./index.js";

const DIST = new URL("../dist/", import.meta.url).pathname;
const env = {
  ASSETS: {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      try {
        return new Response(await readFile(join(DIST, p)), { status: 200 });
      } catch {
        return new Response("not found", { status: 404 });
      }
    },
  },
};

const rpc = async (msg) => {
  const res = await worker.fetch(
    new Request("https://robertdelanghe.dev/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(msg),
    }),
    env,
  );
  return { status: res.status, body: res.status === 202 ? null : await res.json() };
};

test("initialize advertises the protocol and warns that this surface does not verify", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(body.result.protocolVersion, "2025-06-18");
  assert.equal(body.result.serverInfo.name, "robertdelanghe.dev");
  assert.match(body.result.instructions, /does NOT verify/);
});

test("tools/list is one tool per subject, not one per drill-down", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.deepEqual(
    body.result.tools.map((t) => t.name).sort(),
    ["get_conformance", "get_corpus", "get_post", "list_posts"],
  );
});

test("get_conformance defaults to the index and unfolds on request", async () => {
  const idx = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_conformance", arguments: {} } });
  assert.equal(idx.body.result._meta.verification.path, "api/v1/conformance/index.json");
  assert.ok("summary" in JSON.parse(idx.body.result.content[0].text));

  const area = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_conformance", arguments: { area: "accessibility" } } });
  assert.equal(JSON.parse(area.body.result.content[0].text).area, "accessibility");

  const full = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_conformance", arguments: { full: true } } });
  assert.equal(full.body.result._meta.verification.path, "api/v1/conformance.json");
});

test("get_corpus defaults to the index and unfolds one list at a time", async () => {
  const idx = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "get_corpus", arguments: {} } });
  assert.equal(idx.body.result._meta.verification.path, "api/v1/corpus/index.json");
  const topics = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "get_corpus", arguments: { list: "topics" } } });
  assert.ok(JSON.parse(topics.body.result.content[0].text).count > 0);
});

test("every result carries verified:false and a real digest of the bytes returned", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "list_posts", arguments: {} } });
  const v = body.result._meta.verification;
  assert.equal(v.verified, false, "a hosted surface must not claim it verified itself");
  assert.match(v.sha256, /^[0-9a-f]{64}$/);
  // the digest is of the bytes actually handed back, not of something else
  const { createHash } = await import("node:crypto");
  assert.equal(createHash("sha256").update(body.result.content[0].text).digest("hex"), v.sha256);
  assert.equal(v.manifest, "https://robertdelanghe.dev/site.sha256");
});

test("an unknown tool and an unknown method are JSON-RPC errors, not crashes", async () => {
  const t = await rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "rm_rf", arguments: {} } });
  assert.equal(t.body.error.code, -32602);
  const m = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/destroy" });
  assert.equal(m.body.error.code, -32601);
});

test("a notification gets 202 and no body", async () => {
  const { status, body } = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(status, 202);
  assert.equal(body, null);
});

test("resources/read serves a catalogued artifact and refuses anything else", async () => {
  const ok = await rpc({ jsonrpc: "2.0", id: 11, method: "resources/read", params: { uri: "site://profile" } });
  assert.equal(ok.body.result.contents[0].uri, "site://profile");
  const no = await rpc({ jsonrpc: "2.0", id: 12, method: "resources/read", params: { uri: "site://../../etc/passwd" } });
  assert.equal(no.body.error.code, -32602);
});

test("everything that is not /mcp falls through to ASSETS untouched", async () => {
  const res = await worker.fetch(new Request("https://robertdelanghe.dev/index.html"), env);
  const served = await res.text();
  const onDisk = await readFile(join(DIST, "index.html"), "utf8");
  assert.equal(served, onDisk, "the Worker must not rewrite a single byte of an asset");
});

test("GET /mcp is 405, since a stateless server has no stream to open", async () => {
  const res = await worker.fetch(new Request("https://robertdelanghe.dev/mcp"), env);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "POST");
});
