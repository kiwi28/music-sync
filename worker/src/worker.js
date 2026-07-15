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
    const created = new Date(job.created).getTime();
    return created < tenMinutesAgo;
  });

  for (const job of staleJobs) {
    console.log(`[worker] Resetting stale job ${job.id} → pending`);
    await pb.collection("sync_jobs").update(job.id, {
      status: "pending",
      log: `${job.log || ""}\nReset from "running" after worker restart`,
    });
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
    const created = new Date(job.created).getTime();
    return created < sixtyMinutesAgo;
  });

  for (const job of stalePendingJobs) {
    console.log(`[worker] Resetting stale pending job ${job.id} (stuck >60min)`);
    await pb.collection("sync_jobs").update(job.id, {
      log: `${job.log || ""}\nReset — was stuck pending for >60min (worker restart)`,
    });
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
    await pb.collection("sync_jobs").update(job.id, {
      status: "failed",
      error: "Associated playlist not found (orphaned job)",
      completed_at: new Date().toISOString(),
    });
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

    // Job completed successfully
    await pb.collection("sync_jobs").update(job.id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      tracks_added: result.tracksAdded,
      log: `Sync complete. ${result.tracksAdded} new, ${result.totalTracks} total.`,
    });

    // Update playlist stats
    await pb.collection("playlists").update(playlist.id, {
      track_count: result.totalTracks,
      last_synced: new Date().toISOString(),
    });

    console.log(
      `[worker] Job ${job.id} completed: +${result.tracksAdded} tracks`,
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
      // NOTE: expand/sort on sync_jobs is broken in PB 0.28.x — returns 400.
      // The playlist is fetched separately in processJob() instead of expand,
      // and we omit sort to avoid the 400 bug (sort references `created`).
      const jobs = await pb.collection("sync_jobs").getList(1, 5, {
        filter: 'status = "pending"',
      });

      for (const job of jobs.items) {
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
