import { NextResponse } from "next/server";
import { createServerClient, refreshSpotifyToken } from "@/lib/pocketbase-server";
import { isTokenExpired } from "@/lib/pocketbase";
import { fetchSpotifyPlaylists } from "@/lib/spotify";

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

    for (const sp of spotifyPlaylists) {
      if (!sp.tracks) {
        console.warn(`Spotify playlist "${sp.name}" (${sp.id}) has no tracks object — defaulting track_count to 0`);
      }

      const playlistData = {
        name: sp.name,
        description: sp.description || "",
        platform: "spotify",
        platform_id: sp.id,
        user: userId,
        track_count: sp.tracks?.total ?? 0,
        cover_url: sp.images?.[0]?.url || "",
        is_public: sp.public,
      };

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
    }

    return NextResponse.json({
      success: true,
      total: spotifyPlaylists.length,
      created,
      updated,
      message: `Imported ${created} new and updated ${updated} existing playlists`,
    });
  } catch (err) {
    console.error("Import playlists error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
