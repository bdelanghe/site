// EXPERIMENT — force a worker-owned ETag onto HTML responses.
//
// Static files (CSS/JSON/images) already validate via the assets pipeline's ETag.
// HTML routes (html_handling pretty URLs) reach the client with no validator. A
// prior pass-through worker deferred to env.ASSETS's internal HTML ETag and lost
// it; this version instead IGNORES that, buffers the body, hashes it, and returns
// a freshly built Response with its OWN ETag (+ If-None-Match/304). Tests whether a
// worker-owned ETag survives Cloudflare's html_handling serving to the client.
//
// x-shim header is temporary, to confirm execution and which path ran.

const matchesEtag = (inm, etag) =>
  !!inm && (inm.trim() === "*" || inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag));

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    const type = response.headers.get("content-type") || "";
    if (request.method !== "GET" || response.status !== 200 || !type.includes("text/html")) {
      return response; // non-HTML: leave the pipeline ETag untouched
    }

    const body = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", body);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const etag = `"${hex.slice(0, 32)}"`;

    const headers = new Headers(response.headers);
    headers.set("etag", etag); // overwrite any internal ETag with our own
    headers.set("x-shim", "html-etag-forced");

    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: 200, headers });
  },
};
