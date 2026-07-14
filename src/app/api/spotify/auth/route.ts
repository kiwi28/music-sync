import { NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * GET /api/spotify/auth
 * Initiates the Spotify OAuth PKCE flow.
 * Stores the state parameter in a cookie for CSRF verification on callback.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const state = searchParams.get("state");

  if (!state) {
    return NextResponse.json(
      { error: "Missing state parameter" },
      { status: 400 }
    );
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI environment variables." },
      { status: 500 }
    );
  }

  // Store state in an httpOnly cookie for CSRF protection
  const cookieStore = await cookies();
  cookieStore.set("spotify_auth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const authUrl = new URL("https://accounts.spotify.com/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set(
    "scope",
    [
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-public",
      "playlist-modify-private",
      "user-library-read",
    ].join(" ")
  );

  return NextResponse.redirect(authUrl.toString());
}
