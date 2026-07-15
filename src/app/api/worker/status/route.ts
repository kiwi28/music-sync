import { NextResponse } from "next/server";
import PocketBase from "pocketbase";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "worker-status";

/**
 * GET /api/worker/status
 *
 * Returns worker health information from the worker_status singleton.
 * If the collection doesn't exist or the worker hasn't polled in 2+ minutes,
 * returns { online: false }.
 */
export async function GET() {
  try {
    // Fresh client — worker_status is public-read, no auth needed
    const pb = new PocketBase(
      process.env.POCKETBASE_URL || "http://pocketbase:8090",
    );

    const result = await pb.collection("worker_status").getList(1, 1);
    const record = result.items[0];

    if (!record) {
      return NextResponse.json({ online: false });
    }

    const lastPollAt = record.last_poll_at
      ? new Date(record.last_poll_at).getTime()
      : 0;
    const now = Date.now();
    const lastPollSecondsAgo = Math.round((now - lastPollAt) / 1000);

    // Worker is considered online if it polled within the last 2 minutes
    const online = lastPollSecondsAgo < 120;

    return NextResponse.json({
      online,
      lastPollAt: record.last_poll_at || null,
      lastPollSecondsAgo: online ? lastPollSecondsAgo : null,
      scheduler: {
        lastCheckAt: record.scheduler_last_check_at || null,
        nextCheckAt: record.scheduler_next_check_at || null,
        syncIntervalMinutes: record.scheduler_sync_interval_minutes || null,
        checkIntervalMinutes: record.scheduler_check_interval_minutes || null,
        stalePlaylistCount: record.scheduler_stale_playlist_count || 0,
      },
      stats: {
        pendingJobs: record.pending_count || 0,
        runningJobs: record.running_count || 0,
      },
    });
  } catch (err) {
    logApiError({ route: ROUTE, step: "status" }, err);
    // Collection doesn't exist yet or PB is unreachable — worker is offline
    return NextResponse.json({ online: false });
  }
}
