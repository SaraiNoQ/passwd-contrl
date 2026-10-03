// Keep browser sessions first-party while mobile clients use the Worker directly.
const API_ORIGIN = "https://zero-vault-api.sarainosakura.workers.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const upstream = new URL(API_ORIGIN);
    upstream.pathname = url.pathname.slice(4);
    upstream.search = url.search;
    const response = await fetch(new Request(upstream, request), { redirect: "manual" });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  }
};
