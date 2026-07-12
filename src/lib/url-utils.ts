import type { Platform } from "./types";

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

// ── Playlist URL parsing ────────────────────────────────

/** Recognized music platform domains mapped to Platform values */
const PLATFORM_DOMAINS: Record<string, Platform> = {
  "open.spotify.com": "spotify",
  "spotify.com": "spotify",
  "music.apple.com": "apple_music",
  "apple.co": "apple_music",
  "music.youtube.com": "youtube_music",
  "youtube.com": "youtube_music",
  "tidal.com": "tidal",
  "listen.tidal.com": "tidal",
  "deezer.com": "deezer",
  "www.deezer.com": "deezer",
};

/**
 * Detect the music platform from a playlist URL.
 * Returns null if the URL doesn't match any known platform.
 */
export function detectPlatformFromUrl(url: string): Platform | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    return PLATFORM_DOMAINS[host] ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract a playlist ID from a platform URL, if the URL pattern is known.
 * Returns null for platforms/patterns we don't recognize.
 */
export function extractPlatformIdFromUrl(url: string, platform: Platform): string | null {
  try {
    const parsed = new URL(url);

    switch (platform) {
      case "spotify": {
        // https://open.spotify.com/playlist/<id>?...
        const spotifyMatch = parsed.pathname.match(/^\/playlist\/([a-zA-Z0-9]+)/);
        return spotifyMatch?.[1] ?? null;
      }
      case "apple_music": {
        // https://music.apple.com/.../playlist/<name>/pl.<id>
        const appleMatch = parsed.pathname.match(/(pl\.[a-zA-Z0-9]+)/);
        return appleMatch?.[1] ?? null;
      }
      case "youtube_music": {
        // https://music.youtube.com/playlist?list=<id>
        const ytMatch = parsed.searchParams.get("list");
        return ytMatch ?? null;
      }
      case "tidal": {
        // https://tidal.com/browse/playlist/<uuid>
        // https://listen.tidal.com/playlist/<uuid>
        const tidalMatch = parsed.pathname.match(/\/(?:browse\/)?playlist\/([a-f0-9-]+)/);
        return tidalMatch?.[1] ?? null;
      }
      case "deezer": {
        // https://www.deezer.com/.../playlist/<id>
        const deezerMatch = parsed.pathname.match(/\/playlist\/(\d+)/);
        return deezerMatch?.[1] ?? null;
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}
