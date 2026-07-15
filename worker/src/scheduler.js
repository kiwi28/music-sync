// Periodic playlist sync scheduler.
// Runs independently of the job poll loop. Every CHECK_INTERVAL minutes,
// queries all playlists and creates pending sync_jobs for any that haven't
// been synced within the configured SYNC_INTERVAL_MINUTES window.
//
// Design:
//   - Polls at CHECK_INTERVAL = max(15min, SYNC_INTERVAL_MINUTES / 6)
//     so it catches stale playlists within a reasonable fraction of the
//     configured window without hammering PocketBase.
//   - Skips playlists that already have a pending or running job.
//   - Creates jobs as the PocketBase superuser — no per-user auth needed.

import { getAdminClient } from "./pb-client.js";
import { updateSchedulerState } from "./heartbeat.js";

const SYNC_INTERVAL_MINUTES = parseInt(
  process.env.SYNC_INTERVAL_MINUTES || "10080", // default: 7 days
  10,
);

// How often the scheduler checks for stale playlists.
// At most every 15 min, at least every 4 hours. Fraction of the sync window.
const CHECK_INTERVAL_MS = Math.max(
  15 * 60 * 1000,
  Math.min(4 * 60 * 60 * 1000, (SYNC_INTERVAL_MINUTES / 6) * 60 * 1000),
);

/**
 * Run one scheduler tick — find stale playlists and enqueue sync jobs.
 */
async function schedulerTick() {
  let pb;
  try {
    pb = await getAdminClient();
  } catch (err) {
    console.error("[scheduler] Failed to get admin client:", err.message);
    return;
  }

  const cutoff = new Date(
    Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1000,
  ).toISOString();

  console.log(
    `[scheduler] Checking for playlists not synced since ${cutoff}…`,
  );

  try {
    // Fetch all playlists. For a personal instance this is a small list —
    // filtering by last_synced in PB would be ideal but PocketBase filter
    // syntax for date comparisons varies by version, so we filter in JS.
    const playlists = await pb.collection("playlists").getFullList({
      sort: "last_synced",
    });

    let enqueued = 0;

    for (const playlist of playlists) {
      // Stale = never synced, or last synced before the cutoff
      const isStale =
        !playlist.last_synced || playlist.last_synced < cutoff;

      if (!isStale) continue;

      // Check if a job is already in flight for this playlist
      const existingJobs = await pb.collection("sync_jobs").getList(1, 1, {
        filter: `playlist = "${playlist.id}" && (status = "pending" || status = "running")`,
      });

      if (existingJobs.totalItems > 0) {
        console.log(
          `[scheduler] Skipping "${playlist.name}" — already has a pending/running job`,
        );
        continue;
      }

      // Create a pending sync job
      await pb.collection("sync_jobs").create({
        playlist: playlist.id,
        user: playlist.user,
        status: "pending",
        log: `Scheduled re-sync of "${playlist.name}" (last synced: ${playlist.last_synced || "never"})`,
      });

      console.log(`[scheduler] Enqueued re-sync for "${playlist.name}"`);
      enqueued++;
    }

    if (enqueued === 0) {
      console.log("[scheduler] All playlists are up to date.");
    } else {
      console.log(`[scheduler] Enqueued ${enqueued} sync job(s).`);
    }

    // Update scheduler state for UI visibility
    const staleCount = playlists.filter((p) => {
      return !p.last_synced || p.last_synced < cutoff;
    }).length;
    updateSchedulerState(pb, {
      syncIntervalMinutes: SYNC_INTERVAL_MINUTES,
      checkIntervalMs: CHECK_INTERVAL_MS,
      stalePlaylistCount: staleCount,
    }).catch((err) =>
      console.error("[scheduler] Failed to update state:", err.message),
    );
  } catch (err) {
    console.error("[scheduler] Tick failed:", err.message);
  }
}

/**
 * Start the scheduler. Runs one tick immediately, then on the configured
 * CHECK_INTERVAL. Never rejects — errors are logged and the interval
 * continues.
 */
export function startScheduler() {
  const intervalMinutes = Math.round(CHECK_INTERVAL_MS / 60_000);
  console.log(
    `[scheduler] Starting — sync window: ${SYNC_INTERVAL_MINUTES}m, check every ${intervalMinutes}m`,
  );

  // Run immediately on startup so we don't wait CHECK_INTERVAL for the
  // first enqueue.
  schedulerTick().catch((err) =>
    console.error("[scheduler] Initial tick error:", err.message),
  );

  const timer = setInterval(() => {
    schedulerTick().catch((err) =>
      console.error("[scheduler] Tick error:", err.message),
    );
  }, CHECK_INTERVAL_MS);

  // Allow the Node.js event loop to exit if there's nothing else keeping
  // it alive (though the poll loop in worker.js keeps it running).
  timer.unref();
}
