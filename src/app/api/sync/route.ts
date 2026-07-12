import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { syncPlaylistSchema } from "@/lib/validators";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "sync";

/**
 * POST /api/sync
 * Marks a playlist as synced by updating last_synced and creating a sync_job record.
 *
 * No external API calls are made — this is a manual tracking operation.
 * The user verifies the playlist is up-to-date and clicks "Sync Now" to record
 * the timestamp. Future versions can add automatic metadata extraction or
 * public-page scraping here.
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

    const { playlistId } = parsed.data;

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

    const now = new Date().toISOString();

    // ── Create completed sync job ──
    const syncJob = await pb.collection("sync_jobs").create({
      playlist: playlistId,
      user: userId,
      status: "completed",
      started_at: now,
      completed_at: now,
      tracks_added: 0,
      log: `Manual sync of "${playlist.name}"`,
    });

    // ── Update playlist last_synced ──
    await pb.collection("playlists").update(playlistId, {
      last_synced: now,
    });

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
