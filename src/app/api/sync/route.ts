import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { syncPlaylistSchema } from "@/lib/validators";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "sync";

/**
 * POST /api/sync
 *
 * Creates a pending sync_job that the background worker picks up.
 * The worker handles the actual download via spotdl / yt-dlp and
 * updates the job status to "running" → "completed" (or "failed").
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

    // ── Create pending sync job ──
    // The background worker picks this up and does the actual download.
    const syncJob = await pb.collection("sync_jobs").create({
      playlist: playlistId,
      user: userId,
      status: "pending",
      log: `Queued sync of "${playlist.name}"`,
    });
    // playlist.last_synced and track_count are updated by the worker on completion.

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
