// Spotify OAuth token management for the worker.
// Bridges PocketBase-stored tokens (from the web UI OAuth flow) to
// spotdl's expected cache format so users never need to SSH in.
//
// Flow:
//   1. User clicks "Connect Spotify" in Settings → OAuth → tokens saved to
//      PocketBase `user_connections` collection.
//   2. Worker calls ensureSpotifyToken() before each Spotify sync job.
//   3. If access token is expired, it refreshes using the refresh_token.
//   4. Tokens are written to spotdl's cache file (~/.spotdl/.spotipy-cache-*).
//   5. spotdl picks up the cached tokens and authenticates automatically.

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const CACHE_DIR = join(homedir(), ".spotdl");
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/**
 * Ensure valid Spotify tokens are available in spotdl's cache.
 * Reads tokens from PocketBase, refreshes if expired, writes cache file.
 *
 * @param {object} pb - PocketBase admin client
 * @returns {Promise<string>} - The valid access token
 */
export async function ensureSpotifyToken(pb) {
  // Read tokens from PocketBase (any user's connection — single-user setup).
  // NOTE: no sort — PB 0.28.x throws 400 on sort with certain collections.
  const connections = await pb.collection("user_connections").getList(1, 1, {
    filter: 'platform = "spotify"',
  });

  if (connections.items.length === 0) {
    throw new Error(
      "No Spotify connection found. Go to Settings → Connect Spotify to link your account."
    );
  }

  const conn = connections.items[0];
  let { access_token, refresh_token, token_expires_at } = conn;

  // Refresh if expired (or about to expire in 5 minutes)
  const expiresAt = token_expires_at ? new Date(token_expires_at).getTime() : 0;
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    const refreshed = await refreshSpotifyToken(refresh_token);
    access_token = refreshed.access_token;
    if (refreshed.refresh_token) refresh_token = refreshed.refresh_token;
    token_expires_at = new Date(
      Date.now() + refreshed.expires_in * 1000
    ).toISOString();

    // Persist refreshed tokens back to PocketBase
    await pb.collection("user_connections").update(conn.id, {
      access_token,
      refresh_token,
      token_expires_at,
    });
  }

  // Write the token to a file that spotdl reads via --auth-token flag.
  await mkdir(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, "token.json");
  await writeFile(
    cacheFile,
    JSON.stringify({
      access_token,
      token_type: "Bearer",
      expires_in: 3600,
      expires_at: Math.floor(new Date(token_expires_at).getTime() / 1000),
      refresh_token,
      scope: "playlist-read-private playlist-read-collaborative user-library-read",
    }),
    { mode: 0o600 }
  );
  console.log(`[spotify-token] Token cached, expires ${token_expires_at}`);

  return access_token;
}

/**
 * Refresh an expired Spotify access token using the refresh_token.
 */
async function refreshSpotifyToken(refreshToken) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set to refresh tokens.\n" +
      "Add them to your .env file and restart the worker."
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(
      `Spotify token refresh failed. Your Spotify connection may have expired.\n` +
      `Go to Settings → Connect Spotify to re-link your account.\n` +
      `Error: ${err}`
    );
  }

  return response.json();
}
