import "server-only";

import PocketBase from "pocketbase";
import { cookies } from "next/headers";

const PB_URL = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";

/**
 * Create a server-side PocketBase client.
 * Reads the pb_auth cookie and loads the session so all subsequent
 * requests are authenticated as the logged-in user.
 *
 * IMPORTANT: This module uses "server-only" — importing it in a
 * client component will cause a build error.
 */
export async function createServerClient(): Promise<PocketBase> {
  const cookieStore = await cookies();
  const pb = new PocketBase(PB_URL);

  // Load auth from cookie
  const authCookie = cookieStore.get("pb_auth");
  if (authCookie) {
    try {
      pb.authStore.loadFromCookie(authCookie.value);
      console.log("DEBUG createServerClient: isValid after load =", pb.authStore.isValid);
      console.log("DEBUG createServerClient: token =", pb.authStore.token ? "present" : "absent");
      // Always try to refresh — PocketBase authRefresh handles expired tokens
      if (pb.authStore.token) {
        try {
          await pb.collection("users").authRefresh();
          console.log("DEBUG createServerClient: authRefresh succeeded, isValid now =", pb.authStore.isValid);
        } catch (e) {
          console.log("DEBUG createServerClient: authRefresh failed:", e);
          pb.authStore.clear();
        }
      }
    } catch {
      pb.authStore.clear();
    }
  }

  return pb;
}

/**
 * Refresh a Spotify access token using the stored refresh token.
 * Updates the user_connections record with new tokens.
 * Returns the new access token and expiry, or null if refresh failed.
 */
export async function refreshSpotifyToken(
  pb: PocketBase,
  connectionId: string
): Promise<{ access_token: string; expires_at: Date } | null> {
  const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    throw new Error("Missing Spotify OAuth credentials in environment");
  }

  // Get current connection to read refresh token
  const connection = await pb.collection("user_connections").getOne(connectionId);

  if (!connection.refresh_token) {
    return null;
  }

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(
        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
      ).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
  });

  if (!response.ok) {
    // Refresh token is invalid — connection needs re-auth
    await pb.collection("user_connections").update(connectionId, {
      access_token: null,
      refresh_token: null,
    });
    return null;
  }

  const data = await response.json();
  const expires_at = new Date(Date.now() + data.expires_in * 1000);

  // Update stored tokens
  await pb.collection("user_connections").update(connectionId, {
    access_token: data.access_token,
    token_expires_at: expires_at.toISOString(),
    // Spotify only returns a new refresh token if the old one was rotated
    ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
  });

  return { access_token: data.access_token, expires_at };
}
