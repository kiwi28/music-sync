import type {
  SpotifyPlaylist,
  SpotifyTokenResponse,
  SpotifyTrack,
  Track,
} from "./types";

const SPOTIFY_API = "https://api.spotify.com/v1";

/** Default timeout for Spotify API calls (15 seconds) */
const SPOTIFY_FETCH_TIMEOUT_MS = 15_000;

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
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Spotify OAuth configuration");
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Spotify token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Fetch all user playlists from Spotify (handles pagination).
 */
export async function fetchSpotifyPlaylists(accessToken: string): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = [];
  let url: string | null = `${SPOTIFY_API}/me/playlists?limit=50`;

  while (url) {
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch playlists: ${response.statusText}`);
    }

    const data: { items: SpotifyPlaylist[]; next: string | null } = await response.json();
    playlists.push(...data.items);
    url = data.next;
  }

  return playlists;
}

/**
 * Fetch all tracks in a Spotify playlist (handles pagination).
 */
export async function fetchSpotifyPlaylistTracks(
  accessToken: string,
  playlistId: string
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = [];
  let url: string | null = `${SPOTIFY_API}/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    const response: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch tracks: ${response.statusText}`);
    }

    const data: { items: { track: SpotifyTrack | null; type: string }[]; next: string | null } = await response.json();
    // Filter out null items (deleted tracks) and extract track objects
    for (const item of data.items) {
      if (item.track && item.track.type === "track") {
        tracks.push(item.track);
      }
    }
    url = data.next;
  }

  return tracks;
}

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

/**
 * Get the current user's Spotify profile (to verify connection).
 */
export async function fetchSpotifyProfile(accessToken: string): Promise<{
  id: string;
  display_name: string;
}> {
  const response = await fetch(`${SPOTIFY_API}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch profile: ${response.statusText}`);
  }

  return response.json();
}

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
  const response = await fetch(`${SPOTIFY_API}/users/${userId}/playlists`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, description, public: isPublic }),
    signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to create playlist: ${response.statusText}`);
  }

  const data = await response.json();
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
  const BATCH_SIZE = 100;

  for (let i = 0; i < trackUris.length; i += BATCH_SIZE) {
    const batch = trackUris.slice(i, i + BATCH_SIZE);
    const response = await fetch(
      `${SPOTIFY_API}/playlists/${playlistId}/tracks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ uris: batch }),
        signal: AbortSignal.timeout(SPOTIFY_FETCH_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to add tracks (batch ${Math.floor(i / BATCH_SIZE) + 1}): ${error}`
      );
    }
  }
}
