// Background worker — polls PocketBase for pending sync_jobs and dispatches
// downloads to spotdl (Spotify) or yt-dlp (YouTube Music).
//
// Architecture:
//   poll loop → processJob → dispatch by platform → download → dedup → create PB records
//
// The worker runs as the PocketBase superuser so it can operate across all
// user accounts.

import { getAdminClient } from "./pb-client.js";
import { processSpotifyJob } from "./downloads/spotdl.js";
import { processYoutubeMusicJob } from "./downloads/ytdlp.js";
import { sleep, extractErrorMessage } from "./utils.js";
import { startScheduler } from "./scheduler.js";
import { updateHeartbeat } from "./heartbeat.js";

const POLL_INTERVAL_MS = parseInt(
  process.env.POLL_INTERVAL || "15000",
  10,
);

// ── Orphaned-job skip cache ──
// Tracks jobs whose playlist was deleted. When the PB status update fails
// (e.g. due to collection rules), the job would otherwise stay "pending"
// forever and get retried every poll cycle. This cache applies exponential
// backoff so the worker does not hot-loop on unfixable records.
//
// Map<jobId, { until: number; attempt: number }>
//   until   — timestamp (ms) before which the job should be skipped
//   attempt — consecutive failures (drives backoff: 15s * 2^attempt, max 4h)
const orphanedSkipCache = new Map();
const ORPHANED_BASE_BACKOFF_MS = 15_000;           // 15 seconds
const ORPHANED_MAX_BACKOFF_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Map of platform → handler function.
 * Add new platforms here as downloaders are implemented.
 */
const HANDLERS = {
  spotify: processSpotifyJob,
  youtube_music: processYoutubeMusicJob,
};

// ── Startup: reset stale "running" jobs ──
// NOTE: PB 0.28.x throws 400 if sync_jobs queries reference `created`
// in sort or filter. We fetch all running jobs without referencing
// created, then filter stale ones in JS.
async function resetStaleJobs(pb) {
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000;

  // Fetch without sort/filter-on-created — PB 0.28.x workaround.
  // Use getList (not getFullList) to avoid skipTotal=1 which may also
  // trigger the 400 bug on sync_jobs.
  const runningJobs = await pb.collection("sync_jobs").getList(1, 100, {
    filter: 'status = "running"',
  });

  const staleJobs = runningJobs.items.filter((job) => {
    // PB 0.28.x doesn't return the `created` system field for sync_jobs,
    // so we use `started_at` (set when the worker marks the job as running).
    // Fall back to `created` for compatibility, then to `updated` as a last resort.
    const timestamp = job.started_at || job.created || job.updated;
    if (!timestamp) {
      console.warn(`[worker] Job ${job.id} has no timestamp — treating as stale`);
      return true;
    }
    return new Date(timestamp).getTime() < tenMinutesAgo;
  });

  for (const job of staleJobs) {
    console.log(`[worker] Marking stale job ${job.id} as failed (worker was interrupted)`);
    try {
      await pb.collection("sync_jobs").update(job.id, {
        status: "failed",
        error: "Sync interrupted by worker restart",
        completed_at: new Date().toISOString(),
        log: `${job.log || ""}\nMarked as failed after worker restart — interrupted sync.`,
      });
    } catch (err) {
      console.error(`[worker] Failed to update stale job ${job.id}: ${err.message}`);
    }
  }

  if (staleJobs.length) {
    console.log(`[worker] Reset ${staleJobs.length} stale jobs`);
  }

  // Also reset stale "pending" jobs (older than 60 minutes — stuck)
  const sixtyMinutesAgo = Date.now() - 60 * 60 * 1000;
  const pendingJobs = await pb.collection("sync_jobs").getList(1, 100, {
    filter: 'status = "pending"',
  });

  const stalePendingJobs = pendingJobs.items.filter((job) => {
    // PB 0.28.x doesn't return `created` or `updated` for sync_jobs.
    // Without a timestamp we can't determine age — skip rather than falsely
    // flagging as stale. (Running jobs use `started_at` which IS returned.)
    const timestamp = job.created || job.updated;
    if (!timestamp) {
      return false;
    }
    return new Date(timestamp).getTime() < sixtyMinutesAgo;
  });

  for (const job of stalePendingJobs) {
    console.log(`[worker] Marking stale pending job ${job.id} as failed (stuck >60min without being picked up)`);
    try {
      await pb.collection("sync_jobs").update(job.id, {
        status: "failed",
        error: "Job stuck pending for >60 minutes",
        completed_at: new Date().toISOString(),
        log: `${job.log || ""}\nMarked as failed — was stuck pending for >60min.`,
      });
    } catch (err) {
      console.error(`[worker] Failed to update stale pending job ${job.id}: ${err.message}`);
    }
  }

  if (stalePendingJobs.length) {
    console.log(`[worker] Flagged ${stalePendingJobs.length} stale pending jobs`);
  }
}

// ── Main job processing ──
async function processJob(pb, job) {
  // Fetch playlist separately — PB 0.28.x expand on sync_jobs is broken
  let playlist;
  try {
    playlist = await pb.collection("playlists").getOne(job.playlist);
  } catch {
    console.error(`[worker] Orphaned job ${job.id}: playlist ${job.playlist} not found`);
    try {
      await pb.collection("sync_jobs").update(job.id, {
        status: "failed",
        error: "Associated playlist not found (orphaned job)",
        completed_at: new Date().toISOString(),
      });
      // Successfully marked as failed — remove from skip cache if present
      orphanedSkipCache.delete(job.id);
    } catch (updateErr) {
      // PB update itself failed (e.g. collection rule restriction).
      // Add to skip cache with exponential backoff so we do not retry
      // every poll cycle.
      const prev = orphanedSkipCache.get(job.id) || { attempt: 0 };
      const attempt = prev.attempt + 1;
      const delay = Math.min(
        ORPHANED_BASE_BACKOFF_MS * Math.pow(2, attempt),
        ORPHANED_MAX_BACKOFF_MS,
      );
      orphanedSkipCache.set(job.id, {
        until: Date.now() + delay,
        attempt,
      });
      console.error(
        `[worker] Failed to update orphaned job ${job.id} — ` +
        `skipping for ${Math.round(delay / 1000)}s (attempt ${attempt}): ${updateErr.message}`,
      );
    }
    return;
  }

  console.log(`[worker] Processing job ${job.id}: "${playlist.name}" (${playlist.platform})`);

  // Check if the job was cancelled by the user before we start
  const freshJob = await pb.collection("sync_jobs").getOne(job.id);
  if (freshJob.status !== "pending") {
    console.log(
      `[worker] Job ${job.id} status is "${freshJob.status}" — skipping (cancelled or already processed)`,
    );
    return;
  }

  // Mark as running
  await pb.collection("sync_jobs").update(job.id, {
    status: "running",
    started_at: new Date().toISOString(),
    log: `Downloading "${playlist.name}" via ${playlist.platform}…`,
  });

  const handler = HANDLERS[playlist.platform];
  if (!handler) {
    await pb.collection("sync_jobs").update(job.id, {
      status: "failed",
      error: `Unsupported platform: ${playlist.platform}`,
      completed_at: new Date().toISOString(),
      log: `Platform "${playlist.platform}" is not supported for automated sync. Currently supported: ${Object.keys(HANDLERS).join(", ")}.`,
    });
    return;
  }

  // Progress callback — handler calls this at each phase so the
  // frontend polling can show what's happening in real time.
  const updateProgress = (msg) => {
    pb.collection("sync_jobs").update(job.id, { log: msg }).catch(() => {});
  };

  try {
    const result = await handler(playlist, updateProgress);

    // Job completed successfully.
    // The handler's last onProgress call already wrote the full summary
    // (including failure details) to the log field. We only update the
    // structured fields here — don't overwrite log.
    const failedCount = result.failedTracks?.length || 0;
    const updateFields = {
      status: "completed",
      completed_at: new Date().toISOString(),
      tracks_added: result.tracksAdded,
    };
    if (failedCount > 0) {
      updateFields.failed_count = failedCount;
    }
    await pb.collection("sync_jobs").update(job.id, updateFields);

    // Update playlist stats
    await pb.collection("playlists").update(playlist.id, {
      track_count: result.totalTracks,
      last_synced: new Date().toISOString(),
    });

    console.log(
      `[worker] Job ${job.id} completed: +${result.tracksAdded} tracks` +
      (failedCount > 0 ? `, ${failedCount} failed` : ""),
    );
  } catch (err) {
    console.error(`[worker] Job ${job.id} failed:`, err);

    await pb.collection("sync_jobs").update(job.id, {
      status: "failed",
      error: extractErrorMessage(err),
      completed_at: new Date().toISOString(),
      log: `Sync failed: ${extractErrorMessage(err)}`,
    });
  }
}

// ── Main loop ──
async function main() {
  console.log("[worker] Starting music-sync background worker…");

  let pb;
  try {
    pb = await getAdminClient();
  } catch (err) {
    console.error("[worker] Failed to authenticate as admin:", err.message);
    console.error("[worker] Ensure PocketBase is reachable and superuser credentials are correct.");
    process.exit(1);
  }

  // Reset any jobs left in "running" state from a previous crash
  await resetStaleJobs(pb);

  // Start the periodic scheduler for re-syncing stale playlists
  startScheduler();

  console.log(`[worker] Polling every ${POLL_INTERVAL_MS / 1000}s for pending jobs…`);

  while (true) {
    try {
      // Re-verify admin auth before each poll cycle. On cache hit this
      // is a single authRefresh() call (~5ms). If the token was silently
      // invalidated (e.g. PocketBase restarted without PB_ENCRYPTION_KEY),
      // getAdminClient re-authenticates transparently.
      pb = await getAdminClient();

      // NOTE: expand/sort on sync_jobs is broken in PB 0.28.x — returns 400.
      // The playlist is fetched separately in processJob() instead of expand,
      // and we omit sort to avoid the 400 bug (sort references `created`).
      const jobs = await pb.collection("sync_jobs").getList(1, 5, {
        filter: 'status = "pending"',
      });

      for (const job of jobs.items) {
        // Check skip cache — orphaned jobs with failing PB updates
        // get exponential backoff so we do not hot-loop on them.
        const skipEntry = orphanedSkipCache.get(job.id);
        if (skipEntry && Date.now() < skipEntry.until) {
          continue; // still cooling off
        }
        await processJob(pb, job);
      }

      // Heartbeat: signal to the UI that the worker is alive
      updateHeartbeat(pb, {
        pendingCount: jobs.totalItems,
        runningCount: 0,
      }).catch(() => {});
    } catch (err) {
      // Don't crash on transient poll errors — log and retry
      console.error("[worker] Poll error:", err.message);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main();
