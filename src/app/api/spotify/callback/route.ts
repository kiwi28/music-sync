import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@/lib/pocketbase-server";
import { fetchSpotifyProfile } from "@/lib/spotify";
import { getPublicOrigin } from "@/lib/url-utils";

/**
 * GET /api/spotify/callback
 * Handles the Spotify OAuth callback.
 * Exchanges the authorization code for tokens and stores them in PocketBase.
 */
export async function GET(request: Request) {
  // DEBUG: log cookies arriving with the callback
  const dbgCookieStore = await cookies();
  console.log("DEBUG callback cookies:", dbgCookieStore.getAll().map(c => c.name).join(", "));
  console.log("DEBUG pb_auth present:", !!dbgCookieStore.get("pb_auth"));

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
    // 1. Get server PocketBase client and verify user is logged in
    const pb = await createServerClient();
    if (!pb.authStore.isValid) {
      return NextResponse.redirect(
        new URL("/login?error=not_authenticated", getPublicOrigin(request))
      );
    }

    const userId = pb.authStore.record!.id;

    // 2. Exchange authorization code for tokens
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.redirect(
        new URL("/settings?error=spotify_not_configured", getPublicOrigin(request))
      );
    }

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
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      console.error("Spotify token exchange failed:", errText);
      return NextResponse.redirect(
        new URL("/settings?error=token_exchange_failed", getPublicOrigin(request))
      );
    }

    const tokens = await tokenResponse.json();

    // 3. Fetch Spotify user profile to get platform user ID
    let profile: { id: string; display_name: string };
    try {
      profile = await fetchSpotifyProfile(tokens.access_token);
    } catch (err) {
      console.error("Failed to fetch Spotify profile:", err);
      return NextResponse.redirect(
        new URL("/settings?error=profile_fetch_failed", getPublicOrigin(request))
      );
    }

    // 4. Store or update the connection in PocketBase
    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000
    ).toISOString();

    // Check for existing connection to this platform
    const existingConnections = await pb
      .collection("user_connections")
      .getFullList({
        filter: `user = "${userId}" && platform = "spotify"`,
      });

    if (existingConnections.length > 0) {
      // Update existing connection
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
      // Create new connection
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

    // 5. Redirect back to settings with success
    return NextResponse.redirect(
      new URL("/settings?success=spotify_connected", getPublicOrigin(request))
    );
  } catch (err) {
    console.error("Spotify callback error:", err);
    return NextResponse.redirect(
      new URL(
        `/settings?error=${encodeURIComponent("internal_error")}`,
        getPublicOrigin(request)
      )
    );
  }
}
