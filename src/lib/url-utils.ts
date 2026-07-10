/**
 * Build the public origin from forwarded headers set by nginx.
 *
 * In production, nginx proxies to http://127.0.0.1:3100, so request.url
 * reflects that internal address. We reconstruct the public-facing origin
 * from the X-Forwarded-* headers that nginx sets.
 *
 * Falls back to the Host header, then to a hardcoded default.
 */
export function getPublicOrigin(request: Request): string {
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host") ||
    "musicsync.kiw.ro";

  const proto =
    request.headers.get("x-forwarded-proto") ||
    (host === "localhost" || host.startsWith("127.") || host.startsWith("localhost:") ? "http" : "https");

  return `${proto}://${host}`;
}
