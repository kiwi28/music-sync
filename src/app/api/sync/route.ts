import { NextRequest, NextResponse } from "next/server";
import { createServerClient, refreshSpotifyToken } from "@/lib/pocketbase-server";
import { isTokenExpired } from "@/lib/pocketbase";
import {
  fetchSpotifyPlaylists,
  fetchSpotifyPlaylistTracks,
  spotifyTrackToTrack,
} from "@/lib/spotify";
import { syncPlaylistSchema } from "@/lib/validators";
import type { Track } from "@/lib/types";
import { logApiError, apiError } from "@/lib/api-errors";

const ROUTE = "sync";

/**
 * POST /api/sync
 * Triggers a sync operation for a playlist.
 *
 * Currently supports Spotify import:
 * 1. Fetches playlist tracks from Spotify
 * 2. Upserts tracks into the local PocketBase tracks collection
 * 3. Creates playlist_track entries
 * 4. Updates playlist metadata
 * 5. Creates a sync_job record
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // ── Parse & validate input ──
    const body = await request.json();
    const parsed = syncPlaylistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { playlistId, direction, platform } = parsed.data;

    // ── Get the playlist ──
    let playlist;
    try {
      playlist = await pb.collection("playlists").getOne(playlistId);
      if (playlist.user !== userId) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    } catch (err) {
      logApiError({ route: ROUTE, step: "get-playlist", userId }, err);
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    // ── Get platform connection ──
    let connection;
    try {
      const connections = await pb
        .collection("user_connections")
        .getFullList({
          filter: `user = "${userId}" && platform = "${platform}"`,
        });

      if (connections.length === 0) {
        return NextResponse.json(
          { error: `No ${platform} connection found. Connect your account in Settings first.` },
          { status: 400 }
        );
      }
      connection = connections[0];
    } catch (err) {
      logApiError({ route: ROUTE, step: "get-connection", userId }, err);
      return NextResponse.json(
        { error: "Failed to retrieve platform connection" },
        { status: 500 }
      );
    }

    // ── Check/refresh token ──
    let accessToken = connection.access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Platform connection has no access token. Reconnect in Settings." },
        { status: 400 }
      );
    }

    if (isTokenExpired(connection.token_expires_at)) {
      const refreshed = await refreshSpotifyToken(pb, connection.id);
      if (!refreshed) {
        return NextResponse.json(
          { error: "Token refresh failed. Reconnect your account in Settings." },
          { status: 401 }
        );
      }
      accessToken = refreshed.access_token;
    }

    // ── Create sync job ──
    const syncJob = await pb.collection("sync_jobs").create({
      playlist: playlistId,
      user: userId,
      status: "running",
      started_at: new Date().toISOString(),
      log: `Starting ${direction} sync for playlist "${playlist.name}" from ${platform}`,
    });

    try {
      if (platform === "spotify" && direction === "import") {
        await importSpotifyPlaylist(pb, playlistId, playlist.platform_id, accessToken, syncJob.id);
      } else {
        throw new Error(
          `Sync direction "${direction}" for platform "${platform}" is not yet supported`
        );
      }

      // ── Mark sync job complete ──
      // Count tracks for the playlist
      const trackCount = await pb
        .collection("playlist_tracks")
        .getList(1, 1, {
          filter: `playlist = "${playlistId}"`,
        });

      await pb.collection("sync_jobs").update(syncJob.id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        tracks_added: trackCount.totalItems,
        log: `Sync completed: imported ${trackCount.totalItems} tracks`,
      });

      // Update playlist metadata
      await pb.collection("playlists").update(playlistId, {
        last_synced: new Date().toISOString(),
        track_count: trackCount.totalItems,
      });
    } catch (err) {
      // ── Mark sync job failed ──
      logApiError({ route: ROUTE, step: "sync-execute", userId, requestBody: { playlistId, direction, platform } }, err);
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await pb.collection("sync_jobs").update(syncJob.id, {
        status: "failed",
        completed_at: new Date().toISOString(),
        error: errorMessage,
        log: `Sync failed: ${errorMessage}`,
      });
      throw err;
    }

    return NextResponse.json({ success: true, jobId: syncJob.id });
  } catch (err) {
    logApiError({ route: ROUTE, step: "main" }, err);
    const pbErr = err as { status?: number; message?: string; data?: unknown };
    const status = pbErr.status || 500;
    return NextResponse.json(
      {
        error: pbErr.message || "Sync failed",
        details: pbErr.data || undefined,
      },
      { status },
    );
  }
}

/**
 * Import tracks from a Spotify playlist into the local database.
 */
async function importSpotifyPlaylist(
  pb: Awaited<ReturnType<typeof createServerClient>>,
  playlistId: string,
  spotifyPlaylistId: string,
  accessToken: string,
  syncJobId: string
): Promise<void> {
  // 1. Fetch all tracks from Spotify
  const spotifyTracks = await fetchSpotifyPlaylistTracks(
    accessToken,
    spotifyPlaylistId
  );

  // 2. Upsert each track
  let imported = 0;
  const trackIds: string[] = [];

  for (const spotifyTrack of spotifyTracks) {
    const trackData = spotifyTrackToTrack(spotifyTrack);
    try {
      // Check if track already exists (by platform + platform_id)
      const existing = await pb
        .collection("tracks")
        .getFullList({
          filter: `platform = "spotify" && platform_id = "${trackData.platform_id}"`,
        });

      let trackId: string;

      if (existing.length > 0) {
        // Update existing track (metadata may have changed)
        const updated = await pb.collection("tracks").update(existing[0].id, trackData);
        trackId = updated.id;
      } else {
        // Create new track
        const created = await pb.collection("tracks").create(trackData);
        trackId = created.id;
      }

      trackIds.push(trackId);
    } catch (err) {
      logApiError(
        { route: ROUTE, step: `track "${spotifyTrack.name}"`, requestBody: trackData },
        err,
      );
    }
  }

  // 3. Remove old playlist_tracks for this playlist (full refresh)
  const oldTracks = await pb
    .collection("playlist_tracks")
    .getFullList({ filter: `playlist = "${playlistId}"` });

  for (const old of oldTracks) {
    await pb.collection("playlist_tracks").delete(old.id);
  }

  // 4. Create new playlist_tracks
  for (let i = 0; i < trackIds.length; i++) {
    await pb.collection("playlist_tracks").create({
      playlist: playlistId,
      track: trackIds[i],
      position: i,
      added_at: new Date().toISOString(),
    });
    imported++;
  }

  // 5. Update sync job log
  await pb.collection("sync_jobs").update(syncJobId, {
    log: `Imported ${imported}/${spotifyTracks.length} tracks from Spotify`,
  });
}
