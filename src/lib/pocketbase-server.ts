import "server-only";

import PocketBase from "pocketbase";
import { cookies } from "next/headers";
import { logError } from "./api-errors";

const PB_URL = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";
const SOURCE = "pocketbase-server";

/** Default timeout for PocketBase API calls (10 seconds) */
const PB_TIMEOUT_MS = 10_000;

/**
 * Race a promise against a timeout. If the promise doesn't settle within
 * `ms` milliseconds, the timeout rejects with the given `label`.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

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
      // Manually parse cookie JSON — PocketBase SDK 0.27.x has a bug where
      // exportToCookie writes "record" but loadFromCookie expects "model".
      const cookieData = JSON.parse(authCookie.value);
      const token = cookieData.token || null;
      const model = cookieData.record || cookieData.model || null;
      pb.authStore.save(token, model);

      // Always try to refresh (PocketBase handles expired tokens)
      // Wrapped in a timeout — if PB is unreachable, fail fast instead of
      // hanging until nginx gives up and returns 503.
      if (token) {
        try {
          await withTimeout(
            pb.collection("users").authRefresh(),
            PB_TIMEOUT_MS,
            "PocketBase authRefresh",
          );
        } catch (err) {
          logError({ source: SOURCE, fn: "createServerClient", step: "authRefresh" }, err);
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
  const fn = "refreshSpotifyToken";
  const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
  const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    logError({ source: SOURCE, fn }, new Error("Missing Spotify OAuth credentials"));
    throw new Error("Missing Spotify OAuth credentials in environment");
  }

  // Get current connection to read refresh token
  let connection;
  try {
    connection = await pb.collection("user_connections").getOne(connectionId);
  } catch (err) {
    logError({ source: SOURCE, fn, step: "get-connection" }, err);
    return null;
  }

  if (!connection.refresh_token) {
    logError(
      { source: SOURCE, fn, step: "no-refresh-token", requestBody: { connectionId } },
      new Error("Connection has no refresh_token"),
    );
    return null;
  }

  const tokenUrl = "https://accounts.spotify.com/api/token";
  let response: Response;
  try {
    response = await fetch(tokenUrl, {
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
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    logError({ source: SOURCE, fn, step: "fetch", url: tokenUrl }, err);
    return null;
  }

  if (!response.ok) {
    const body = await response.text();
    logError(
      { source: SOURCE, fn, step: "spotify-refresh", url: tokenUrl, status: response.status, responseBody: body },
      new Error("Spotify token refresh rejected"),
    );
    // Refresh token is invalid — clear stored tokens so user is prompted to re-auth
    try {
      await pb.collection("user_connections").update(connectionId, {
        access_token: null,
        refresh_token: null,
      });
    } catch (err) {
      logError({ source: SOURCE, fn, step: "clear-tokens" }, err);
    }
    return null;
  }

  let data: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    data = await response.json();
  } catch (err) {
    logError({ source: SOURCE, fn, step: "parse-json", url: tokenUrl }, err);
    return null;
  }

  const expires_at = new Date(Date.now() + data.expires_in * 1000);

  // Update stored tokens
  try {
    await pb.collection("user_connections").update(connectionId, {
      access_token: data.access_token,
      token_expires_at: expires_at.toISOString(),
      // Spotify only returns a new refresh token if the old one was rotated
      ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
    });
  } catch (err) {
    logError({ source: SOURCE, fn, step: "save-tokens" }, err);
    // Token was refreshed successfully — return it even if PB save failed,
    // so the current operation can still complete.
  }

  return { access_token: data.access_token, expires_at };
}
