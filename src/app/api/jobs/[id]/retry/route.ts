import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "jobs-retry";

/**
 * POST /api/jobs/[id]/retry
 *
 * Creates a new pending sync job for the same playlist as the given job.
 * This is the preferred way to retry — it creates a fresh job record
 * rather than mutating the old one.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const userId = pb.authStore.record.id;

    // ── Fetch the original job ──
    let originalJob;
    try {
      originalJob = await pb.collection("sync_jobs").getOne(id);
    } catch {
      return NextResponse.json(
        { error: "Original job not found" },
        { status: 404 },
      );
    }

    if (originalJob.user !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // ── Verify the playlist still exists ──
    let playlist;
    try {
      playlist = await pb.collection("playlists").getOne(originalJob.playlist);
    } catch {
      return NextResponse.json(
        { error: "Associated playlist no longer exists" },
        { status: 404 },
      );
    }

    // ── Check for existing pending/running job ──
    const existing = await pb.collection("sync_jobs").getList(1, 1, {
      filter: `playlist = "${playlist.id}" && (status = "pending" || status = "running")`,
    });
    if (existing.totalItems > 0) {
      return NextResponse.json(
        { error: "A sync is already in progress or queued for this playlist" },
        { status: 409 },
      );
    }

    // ── Create a fresh pending job ──
    const newJob = await pb.collection("sync_jobs").create({
      playlist: playlist.id,
      user: userId,
      status: "pending",
      log: `Retry of job ${id}: Queued sync of "${playlist.name}"`,
    });

    return NextResponse.json(newJob, { status: 201 });
  } catch (err) {
    logApiError({ route: ROUTE, step: "retry" }, err);
    return NextResponse.json(
      { error: "Failed to retry job" },
      { status: 500 },
    );
  }
}
