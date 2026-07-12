import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/pocketbase-server";
import { fetchSpotifyProfile } from "@/lib/spotify";
import { getPublicOrigin } from "@/lib/url-utils";
import { logApiError } from "@/lib/api-errors";
import { setFlash } from "@/lib/flash-server";

const ROUTE = "spotify/callback";

/**
 * Human-readable messages keyed by the internal error codes used in this route.
 */
const ERROR_MESSAGES: Record<string, string> = {
  spotify_auth_denied: "Spotify authorization was denied.",
  missing_params: "Missing parameters in Spotify callback.",
  csrf_mismatch: "Security check failed. Please try again.",
  not_authenticated: "Your session expired. Please log in again.",
  spotify_not_configured: "Spotify integration is not configured on the server.",
  token_exchange_failed: "Failed to exchange Spotify authorization code.",
  profile_fetch_failed: "Failed to fetch your Spotify profile.",
  pb_unreachable: "The database is temporarily unavailable. Please try again in a moment.",
  pb_write_failed: "Failed to save your Spotify connection. Please try again.",
  internal_error: "An unexpected error occurred. Please try again.",
};

/**
 * Set a flash error and redirect to a clean URL.
 * The flash cookie carries the message; the URL stays free of query params.
 */
async function redirectWithError(
  request: Request,
  code: string,
  destination: "/settings" | "/login" = "/settings",
): Promise<NextResponse> {
  const message = ERROR_MESSAGES[code] ?? `Error: ${code}`;
  await setFlash({ type: "error", message, route: destination });
  return NextResponse.redirect(new URL(destination, getPublicOrigin(request)));
}

/**
 * GET /api/spotify/callback
 * Handles the Spotify OAuth callback.
 * Exchanges the authorization code for tokens and stores them in PocketBase.
 *
 * All outcomes redirect to a clean URL — messages are delivered via
 * a short-lived flash cookie, never via query parameters.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // ── User denied authorization on Spotify ──
  if (error) {
    return redirectWithError(request, "spotify_auth_denied");
  }

  // ── Validate required params ──
  if (!code || !state) {
    return redirectWithError(request, "missing_params");
  }

  // ── Verify state to prevent CSRF ──
  const cookieStore = await cookies();
  const savedState = cookieStore.get("spotify_auth_state");
  if (!savedState || savedState.value !== state) {
    return redirectWithError(request, "csrf_mismatch");
  }

  // Clear the state cookie now that it's been verified
  cookieStore.delete("spotify_auth_state");

  try {
    // ── Step 1: PocketBase auth ──
    let pb: Awaited<ReturnType<typeof createServerClient>>;
    try {
      pb = await createServerClient();
    } catch (err) {
      console.error("[callback:step1] createServerClient failed:", err instanceof Error ? err.message : err);
      return redirectWithError(request, "pb_unreachable");
    }

    if (!pb.authStore.isValid) {
      return redirectWithError(request, "not_authenticated", "/login");
    }

    const userId = pb.authStore.record!.id;

    // ── Step 2: Exchange authorization code for tokens ──
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return redirectWithError(request, "spotify_not_configured");
    }

    let tokens: { access_token: string; refresh_token: string; expires_in: number };
    try {
      const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
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
        signal: AbortSignal.timeout(15_000),
      });

      if (!tokenResponse.ok) {
        const errText = await tokenResponse.text();
        console.error("[callback:step2] Spotify token exchange failed:", tokenResponse.status, errText);
        return redirectWithError(request, "token_exchange_failed");
      }

      tokens = await tokenResponse.json();
    } catch (err) {
      console.error("[callback:step2] Token exchange error:", err instanceof Error ? err.message : err);
      return redirectWithError(request, "token_exchange_failed");
    }

    // ── Step 3: Fetch Spotify user profile ──
    let profile: { id: string; display_name: string };
    try {
      profile = await fetchSpotifyProfile(tokens.access_token);
    } catch (err) {
      console.error("[callback:step3] Failed to fetch Spotify profile:", err instanceof Error ? err.message : err);
      return redirectWithError(request, "profile_fetch_failed");
    }

    // ── Step 4: Store/update connection in PocketBase ──
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    try {
      const existingConnections = await pb
        .collection("user_connections")
        .getFullList({
          filter: `user = "${userId}" && platform = "spotify"`,
        });

      if (existingConnections.length > 0) {
        await pb.collection("user_connections").update(
          existingConnections[0].id,
          {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            token_expires_at: expiresAt,
            platform_user_id: profile.id,
            platform_username: profile.display_name,
          }
        );
      } else {
        await pb.collection("user_connections").create({
          user: userId,
          platform: "spotify",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expires_at: expiresAt,
          platform_user_id: profile.id,
          platform_username: profile.display_name,
        });
      }
    } catch (err) {
      logApiError({ route: ROUTE, step: "step4:pb-upsert", userId }, err);
      return redirectWithError(request, "pb_write_failed");
    }

    // ── Step 5: Redirect to settings with success flash ──
    await setFlash({ type: "success", message: "Spotify connected successfully!", route: "/settings" });
    return NextResponse.redirect(new URL("/settings", getPublicOrigin(request)));
  } catch (err) {
    logApiError({ route: ROUTE, step: "unhandled" }, err);
    return redirectWithError(request, "internal_error");
  }
}
