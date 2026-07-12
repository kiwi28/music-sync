import { NextResponse } from "next/server";
import { createServerClient, refreshSpotifyToken } from "@/lib/pocketbase-server";
import { isTokenExpired } from "@/lib/pocketbase";
import { fetchSpotifyPlaylists } from "@/lib/spotify";
import { logApiError, apiError } from "@/lib/api-errors";

const ROUTE = "spotify/import";

/**
 * POST /api/spotify/import
 * Fetches all playlists from the user's connected Spotify account
 * and creates/updates local playlist records in PocketBase.
 */
export async function POST() {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // Get Spotify connection
    const connections = await pb
      .collection("user_connections")
      .getFullList({
        filter: `user = "${userId}" && platform = "spotify"`,
      });

    if (connections.length === 0) {
      return NextResponse.json(
        { error: "Spotify is not connected. Connect your account first." },
        { status: 400 }
      );
    }

    const connection = connections[0];
    let accessToken = connection.access_token;

    if (!accessToken) {
      return NextResponse.json(
        { error: "No access token. Reconnect Spotify in Settings." },
        { status: 400 }
      );
    }

    // Refresh token if needed
    if (isTokenExpired(connection.token_expires_at)) {
      const refreshed = await refreshSpotifyToken(pb, connection.id);
      if (!refreshed) {
        return NextResponse.json(
          { error: "Token refresh failed. Reconnect Spotify." },
          { status: 401 }
        );
      }
      accessToken = refreshed.access_token;
    }

    // Fetch all Spotify playlists
    let spotifyPlaylists;
    try {
      spotifyPlaylists = await fetchSpotifyPlaylists(accessToken);
    } catch (err) {
      return NextResponse.json(
        { error: `Failed to fetch playlists from Spotify: ${err instanceof Error ? err.message : "Unknown error"}` },
        { status: 502 }
      );
    }

    // Upsert playlists into PocketBase
    let created = 0;
    let updated = 0;
    const errors: Array<{ name: string; error: string }> = [];

    for (const sp of spotifyPlaylists) {
      if (!sp.tracks) {
        console.warn(`Spotify playlist "${sp.name}" (${sp.id}) has no tracks object — defaulting track_count to 0`);
      }

      // PocketBase requires a non-empty name, but Spotify allows blank names
      // (e.g. AI-generated playlists or system folders).
      const name = sp.name?.trim() || "Untitled Playlist";

      const playlistData: Record<string, unknown> = {
        name,
        description: sp.description || "",
        platform: "spotify",
        platform_id: sp.id,
        user: userId,
        track_count: sp.tracks?.total ?? 0,
        is_public: sp.public,
      };

      // Only include cover_url when there is one — PocketBase `url` field
      // rejects empty strings.
      if (sp.images?.[0]?.url) {
        playlistData.cover_url = sp.images[0].url;
      }

      try {
        // Check if already imported
        const existing = await pb.collection("playlists").getFullList({
          filter: `user = "${userId}" && platform = "spotify" && platform_id = "${sp.id}"`,
        });

        if (existing.length > 0) {
          await pb.collection("playlists").update(existing[0].id, playlistData);
          updated++;
        } else {
          await pb.collection("playlists").create(playlistData);
          created++;
        }
      } catch (err) {
        logApiError(
          { route: ROUTE, step: `playlist "${sp.name}"`, userId, requestBody: playlistData },
          err,
        );
        const pbError = err as Record<string, unknown>;
        errors.push({
          name: sp.name,
          error: pbError.data
            ? JSON.stringify(pbError.data)
            : (pbError.message as string) || "Unknown error",
        });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: spotifyPlaylists.length,
      created,
      updated,
      errors: errors.length > 0 ? errors : undefined,
      message: `Imported ${created} new and updated ${updated} existing playlists${errors.length > 0 ? ` (${errors.length} failed)` : ""}`,
    });
  } catch (err) {
    logApiError({ route: ROUTE, userId: "unknown" }, err);
    return apiError(err, "Import failed");
  }
}
