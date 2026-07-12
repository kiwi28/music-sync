import type {
  SpotifyPlaylist,
  SpotifyTokenResponse,
  SpotifyTrack,
  Track,
} from "./types";
import { logError } from "./api-errors";

const SPOTIFY_API = "https://api.spotify.com/v1";
const SOURCE = "spotify";

/** Default timeout for Spotify API calls (15 seconds) */
const SPOTIFY_FETCH_TIMEOUT_MS = 15_000;

// ── Helpers ───────────────────────────────────────────

/**
 * Log and throw after a failed Spotify API call.
 * Always reads the response body for full diagnostic context.
 */
async function failFetch(
  fn: string,
  response: Response,
  context?: string,
): Promise<never> {
  const body = await response.text();
  logError(
    {
      source: SOURCE,
      fn,
      url: response.url,
      status: response.status,
      responseBody: body,
    },
    new Error(`Spotify API returned ${response.status}`),
  );
  const detail = context ? ` (${context})` : "";
  throw new Error(`Spotify ${fn} failed: HTTP ${response.status}${detail} — ${body}`);
}

// ── Auth ──────────────────────────────────────────────

/**
 * Build the Spotify OAuth authorization URL.
 * State parameter prevents CSRF — store it in a cookie and verify on callback.
 */
export function buildSpotifyAuthUrl(state: string): string {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    throw new Error("Missing SPOTIFY_CLIENT_ID or SPOTIFY_REDIRECT_URI");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
    scope: [
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
      "user-library-read",
    ].join(" "),
  });

  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeSpotifyCode(
  code: string
): Promise<SpotifyTokenResponse> {
  const fn = "exchangeSpotifyCode";
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Spotify OAuth configuration");
  }

  let response: Response;
  try {
    response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    logError({ source: SOURCE, fn, step: "fetch" }, err);
    throw new Error(`Spotify token exchange network error: ${err instanceof Error ? err.message : err}`);
  }

  if (!response.ok) {
    await failFetch(fn, response, "token exchange");
  }

  try {
    return await response.json();
  } catch (err) {
    logError({ source: SOURCE, fn, step: "parse-json" }, err);
    throw new Error("Spotify token exchange returned invalid JSON");
  }
}

// ── Playlists ─────────────────────────────────────────

/**
 * Fetch all user playlists from Spotify (handles pagination).
 */
export async function fetchSpotifyPlaylists(accessToken: string): Promise<SpotifyPlaylist[]> {
  const fn = "fetchSpotifyPlaylists";
  const playlists: SpotifyPlaylist[] = [];
  let url: string | null = `${SPOTIFY_API}/me/playlists?limit=50`;

  while (url) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      logError({ source: SOURCE, fn, step: "fetch", url }, err);
      throw new Error(`Failed to fetch playlists: ${err instanceof Error ? err.message : err}`);
    }

    if (!response.ok) {
      await failFetch(fn, response);
    }

    let data: { items: SpotifyPlaylist[]; next: string | null };
    try {
      data = await response.json();
    } catch (err) {
      logError({ source: SOURCE, fn, step: "parse-json", url }, err);
      throw new Error("Spotify playlists response was not valid JSON");
    }

    // Log first page's shape once to diagnose schema mismatches
    if (playlists.length === 0 && data.items.length > 0) {
      const first = data.items[0] as unknown as Record<string, unknown>;
      console.error(`[${SOURCE}::${fn}] first playlist keys:`, Object.keys(first).sort().join(", "));
      console.error(`[${SOURCE}::${fn}] first playlist tracks field:`, JSON.stringify(first.tracks));
    }

    if (!Array.isArray(data.items)) {
      logError({ source: SOURCE, fn, url, responseBody: JSON.stringify(data) }, new Error("items is not an array"));
      throw new Error("Spotify playlists response has unexpected shape: items is not an array");
    }

    playlists.push(...data.items);
    url = data.next;
  }

  return playlists;
}

// ── Tracks ────────────────────────────────────────────

/**
 * Fetch all tracks in a Spotify playlist (handles pagination).
 */
export async function fetchSpotifyPlaylistTracks(
  accessToken: string,
  playlistId: string
): Promise<SpotifyTrack[]> {
  const fn = "fetchSpotifyPlaylistTracks";
  const tracks: SpotifyTrack[] = [];
  let url: string | null = `${SPOTIFY_API}/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      logError({ source: SOURCE, fn, url, step: "fetch" }, err);
      throw new Error(`Failed to fetch tracks: ${err instanceof Error ? err.message : err}`);
    }

    if (!response.ok) {
      const body = await response.text();
      logError(
        { source: SOURCE, fn, url, status: response.status, responseBody: body },
        new Error(`Spotify returned ${response.status}`),
      );
      if (response.status === 403) {
        throw new Error(
          "Spotify access denied — your connection may be missing required permissions. " +
          "Reconnect Spotify in Settings to re-authorize with the correct scopes."
        );
      }
      if (response.status === 404) {
        throw new Error(`Playlist not found on Spotify (it may have been deleted): ${playlistId}`);
      }
      throw new Error(`Failed to fetch tracks: HTTP ${response.status} — ${body}`);
    }

    let data: { items: { track: SpotifyTrack | null }[]; next: string | null };
    try {
      data = await response.json();
    } catch (err) {
      logError({ source: SOURCE, fn, url, step: "parse-json" }, err);
      throw new Error("Spotify tracks response was not valid JSON");
    }

    if (!Array.isArray(data.items)) {
      logError({ source: SOURCE, fn, url, responseBody: JSON.stringify(data) }, new Error("items is not an array"));
      throw new Error("Spotify tracks response has unexpected shape");
    }

    for (const item of data.items) {
      if (item.track && item.track.type === "track") {
        tracks.push(item.track);
      }
    }
    url = data.next;
  }

  return tracks;
}

// ── Mappers ───────────────────────────────────────────

/**
 * Map a Spotify track to our internal Track type.
 */
export function spotifyTrackToTrack(spotifyTrack: SpotifyTrack): Omit<Track, "id"> {
  return {
    title: spotifyTrack.name,
    artist: spotifyTrack.artists.map((a) => a.name).join(", "),
    album: spotifyTrack.album?.name,
    platform: "spotify",
    platform_id: spotifyTrack.id,
    duration_ms: spotifyTrack.duration_ms,
    isrc: spotifyTrack.external_ids?.isrc || undefined,
    cover_url: spotifyTrack.album?.images?.[0]?.url,
  };
}

// ── Profile ───────────────────────────────────────────

/**
 * Get the current user's Spotify profile (to verify connection).
 */
export async function fetchSpotifyProfile(accessToken: string): Promise<{
  id: string;
  display_name: string;
}> {
  const fn = "fetchSpotifyProfile";
  let response: Response;
  try {
    response = await fetch(`${SPOTIFY_API}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    logError({ source: SOURCE, fn, step: "fetch" }, err);
    throw new Error(`Failed to fetch Spotify profile: ${err instanceof Error ? err.message : err}`);
  }

  if (!response.ok) {
    await failFetch(fn, response);
  }

  try {
    return await response.json();
  } catch (err) {
    logError({ source: SOURCE, fn, step: "parse-json" }, err);
    throw new Error("Spotify profile response was not valid JSON");
  }
}

// ── Create / Modify ───────────────────────────────────

/**
 * Create a new playlist on Spotify.
 * Returns the created playlist's Spotify ID.
 */
export async function createSpotifyPlaylist(
  accessToken: string,
  userId: string,
  name: string,
  description?: string,
  isPublic = false
): Promise<string> {
  const fn = "createSpotifyPlaylist";
  const url = `${SPOTIFY_API}/users/${userId}/playlists`;
  const body = { name, description, public: isPublic };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    logError({ source: SOURCE, fn, step: "fetch", url, requestBody: body }, err);
    throw new Error(`Failed to create Spotify playlist: ${err instanceof Error ? err.message : err}`);
  }

  if (!response.ok) {
    await failFetch(fn, response);
  }

  let data: { id: string };
  try {
    data = await response.json();
  } catch (err) {
    logError({ source: SOURCE, fn, step: "parse-json", url }, err);
    throw new Error("Spotify create playlist response was not valid JSON");
  }
  return data.id;
}

/**
 * Add tracks to a Spotify playlist (batched, max 100 per request).
 */
export async function addTracksToSpotifyPlaylist(
  accessToken: string,
  playlistId: string,
  trackUris: string[]
): Promise<void> {
  const fn = "addTracksToSpotifyPlaylist";
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(trackUris.length / BATCH_SIZE);

  for (let i = 0; i < trackUris.length; i += BATCH_SIZE) {
    const batch = trackUris.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const url = `${SPOTIFY_API}/playlists/${playlistId}/tracks`;
    const body = { uris: batch };

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      logError(
        { source: SOURCE, fn, step: `batch ${batchNum}/${totalBatches}`, url },
        err,
      );
      throw new Error(
        `Failed to add tracks (batch ${batchNum}/${totalBatches}): ${err instanceof Error ? err.message : err}`
      );
    }

    if (!response.ok) {
      await failFetch(fn, response, `batch ${batchNum}/${totalBatches}`);
    }
  }
}
