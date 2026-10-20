import type { Context } from "hono";

/** Upstream Next.js origin (local). Prefer IPv4 loopback for Node fetch. */
export const WEB_ORIGIN =
  process.env.WEB_ORIGIN || "http://127.0.0.1:3000";

/**
 * Paths owned by the API — never proxied to Next.
 * Everything else (/, /_next/*, favicon, etc.) goes to the web UI.
 */
export function isApiPath(pathname: string): boolean {
  if (pathname === "/health" || pathname === "/openapi.json") return true;
  if (pathname === "/aps" || pathname.startsWith("/aps/")) return true;
  if (pathname === "/projects" || pathname.startsWith("/projects/")) return true;
  if (pathname === "/jobs" || pathname.startsWith("/jobs/")) return true;
  if (pathname === "/mapping-profiles" || pathname.startsWith("/mapping-profiles/")) {
    return true;
  }
  if (pathname === "/api") return true;
  return false;
}

/** Reverse-proxy the request to Next so the UI is reachable on the API port (:8787). */
export async function proxyToNext(c: Context): Promise<Response> {
  const incoming = new URL(c.req.url);
  const target = new URL(incoming.pathname + incoming.search, WEB_ORIGIN);

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    // Let fetch set content-length; avoid hop-by-hop / encoding surprises
    if (
      lower === "host" ||
      lower === "connection" ||
      lower === "content-length" ||
      lower === "transfer-encoding" ||
      lower === "accept-encoding"
    ) {
      return;
    }
    headers.set(key, value);
  });
  // Ask Next for uncompressed body so we don't mishandle gzip streams
  headers.set("accept-encoding", "identity");
  headers.set(
    "x-forwarded-host",
    c.req.header("host") || `127.0.0.1:${process.env.API_PORT || 8787}`,
  );
  headers.set("x-forwarded-proto", "http");
  headers.set("x-forwarded-for", c.req.header("x-forwarded-for") || "127.0.0.1");

  const method = c.req.method;
  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await c.req.arrayBuffer();
  }

  try {
    const upstream = await fetch(target, init);
    // Buffer fully — streaming through Hono has blanked the browser page
    const buf = await upstream.arrayBuffer();
    const outHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        lower === "transfer-encoding" ||
        lower === "connection" ||
        lower === "content-encoding" ||
        lower === "content-length"
      ) {
        return;
      }
      outHeaders.set(key, value);
    });
    outHeaders.set("content-length", String(buf.byteLength));
    return new Response(buf, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: outHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      `<!doctype html><html><body style="font-family:sans-serif;padding:2rem;background:#0f1c18;color:#e8f2ec">
        <h1>Web UI unavailable</h1>
        <p>Could not reach Next.js at <code>${WEB_ORIGIN}</code>.</p>
        <p><code>${message}</code></p>
        <p>API is still up — try <a href="/health" style="color:#c4a35a">/health</a>.</p>
      </body></html>`,
      {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
