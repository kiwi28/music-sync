import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/pocketbase-server";
import { fetchSpotifyProfile } from "@/lib/spotify";
import { getPublicOrigin } from "@/lib/url-utils";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "spotify/callback";

/**
 * GET /api/spotify/callback
 * Handles the Spotify OAuth callback.
 * Exchanges the authorization code for tokens and stores them in PocketBase.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Check for user-denied authorization
  if (error) {
    return NextResponse.redirect(
      new URL("/settings?error=spotify_auth_denied", getPublicOrigin(request))
    );
  }

  // Validate required params
  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/settings?error=missing_params", getPublicOrigin(request))
    );
  }

  // Verify state to prevent CSRF
  const cookieStore = await cookies();
  const savedState = cookieStore.get("spotify_auth_state");
  if (!savedState || savedState.value !== state) {
    return NextResponse.redirect(
      new URL("/settings?error=csrf_mismatch", getPublicOrigin(request))
    );
  }

  // Clear the state cookie
  cookieStore.delete("spotify_auth_state");

  try {
    // ── Step 1: PocketBase auth ──
    let pb: Awaited<ReturnType<typeof createServerClient>>;
    try {
      pb = await createServerClient();
    } catch (err) {
      console.error("[callback:step1] createServerClient failed:", err instanceof Error ? err.message : err);
      return NextResponse.redirect(
        new URL("/settings?error=pb_unreachable", getPublicOrigin(request))
      );
    }

    if (!pb.authStore.isValid) {
      return NextResponse.redirect(
        new URL("/login?error=not_authenticated", getPublicOrigin(request))
      );
    }

    const userId = pb.authStore.record!.id;

    // ── Step 2: Exchange authorization code for tokens ──
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.redirect(
        new URL("/settings?error=spotify_not_configured", getPublicOrigin(request))
      );
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
        return NextResponse.redirect(
          new URL("/settings?error=token_exchange_failed", getPublicOrigin(request))
        );
      }

      tokens = await tokenResponse.json();
    } catch (err) {
      console.error("[callback:step2] Token exchange error:", err instanceof Error ? err.message : err);
      return NextResponse.redirect(
        new URL("/settings?error=token_exchange_failed", getPublicOrigin(request))
      );
    }

    // ── Step 3: Fetch Spotify user profile ──
    let profile: { id: string; display_name: string };
    try {
      profile = await fetchSpotifyProfile(tokens.access_token);
    } catch (err) {
      console.error("[callback:step3] Failed to fetch Spotify profile:", err instanceof Error ? err.message : err);
      return NextResponse.redirect(
        new URL("/settings?error=profile_fetch_failed", getPublicOrigin(request))
      );
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
      return NextResponse.redirect(
        new URL("/settings?error=pb_write_failed", getPublicOrigin(request))
      );
    }

    // ── Step 5: Redirect with success ──
    return NextResponse.redirect(
      new URL("/settings?success=spotify_connected", getPublicOrigin(request))
    );
  } catch (err) {
    logApiError({ route: ROUTE, step: "unhandled" }, err);
    return NextResponse.redirect(
      new URL(
        `/settings?error=${encodeURIComponent("internal_error")}`,
        getPublicOrigin(request)
      )
    );
  }
}
