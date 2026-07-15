// Writes worker health/status to the worker_status singleton collection.
// Called after each poll loop iteration and after each scheduler tick.

/**
 * Update the worker heartbeat after a poll loop iteration.
 * Creates the singleton record if it doesn't exist yet.
 */
export async function updateHeartbeat(pb, { pendingCount, runningCount }) {
  try {
    const existing = await pb.collection("worker_status").getList(1, 1);
    const record = existing.items[0];

    const data = {
      last_poll_at: new Date().toISOString(),
      pending_count: pendingCount,
      running_count: runningCount,
    };

    if (record) {
      await pb.collection("worker_status").update(record.id, data);
    } else {
      await pb.collection("worker_status").create(data);
    }
  } catch (err) {
    // Heartbeat failures are non-fatal — the poll loop continues.
    console.error("[heartbeat] Failed to update:", err.message);
  }
}

/**
 * Update scheduler state after a scheduler tick.
 */
export async function updateSchedulerState(pb, {
  syncIntervalMinutes,
  checkIntervalMs,
  stalePlaylistCount,
}) {
  try {
    const existing = await pb.collection("worker_status").getList(1, 1);
    const record = existing.items[0];

    const data = {
      scheduler_last_check_at: new Date().toISOString(),
      scheduler_next_check_at: new Date(
        Date.now() + checkIntervalMs,
      ).toISOString(),
      scheduler_sync_interval_minutes: syncIntervalMinutes,
      scheduler_check_interval_minutes: Math.round(checkIntervalMs / 60_000),
      scheduler_stale_playlist_count: stalePlaylistCount,
    };

    if (record) {
      await pb.collection("worker_status").update(record.id, data);
    } else {
      // Create with heartbeat fields too so both paths converge on one record
      await pb.collection("worker_status").create({
        ...data,
        last_poll_at: new Date().toISOString(),
        pending_count: 0,
        running_count: 0,
      });
    }
  } catch (err) {
    console.error(
      "[heartbeat] Failed to update scheduler state:",
      err.message,
    );
  }
}
