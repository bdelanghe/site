// Static-assets Worker for robertdelanghe.dev.
//
// Static files (images, CSS, JSON, .txt) already carry strong content ETags from
// the Workers Assets pipeline, so they validate with 304 out of the box. HTML
// routes served via html_handling (the pretty-URL rewrites) don't get one. This
// Worker runs first (assets.run_worker_first), fetches the asset, and — for HTML
// responses that lack an ETag — attaches a content-hash ETag and answers
// conditional requests with 304. Every route, HTML included, then validates via
// ETag. Non-HTML and already-tagged responses pass through untouched.

// If-None-Match per RFC 7232: "*", or a comma-separated list, entries possibly weak.
const matchesEtag = (inm, etag) =>
  !!inm && (inm.trim() === "*" || inm.split(",").some((t) => t.trim().replace(/^W\//, "") === etag));

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);

    // Only post-process GET HTML 200s that don't already carry an ETag. HEAD has no
    // body to hash (its ETag would diverge from GET), so leave it — browsers
    // validate documents with GET.
    const type = response.headers.get("content-type") || "";
    if (
      request.method !== "GET" ||
      response.status !== 200 ||
      !type.includes("text/html") ||
      response.headers.get("etag")
    ) {
      return response;
    }

    const body = await response.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", body);
    const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    const etag = `"${hex.slice(0, 32)}"`;

    const headers = new Headers(response.headers);
    headers.set("etag", etag);

    if (matchesEtag(request.headers.get("if-none-match"), etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  },
};
