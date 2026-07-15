"use client";

import { useWorkerStatus } from "@/hooks/use-jobs";

export function WorkerStatusBar() {
  const {
    online,
    lastPollSecondsAgo,
    scheduler,
    stats,
    loading,
  } = useWorkerStatus();

  if (loading) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2">
        <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  const dotColor = online
    ? "bg-green-500"
    : "bg-red-500";
  const statusText = online
    ? `Worker online — last poll ${lastPollSecondsAgo}s ago`
    : "Worker offline";

  function formatMinutes(minutes: number | null): string {
    if (!minutes) return "—";
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function timeUntil(isoString: string | null): string {
    if (!isoString) return "—";
    const ms = new Date(isoString).getTime() - Date.now();
    if (ms <= 0) return "now";
    const minutes = Math.round(ms / 60_000);
    return formatMinutes(minutes);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-white/40">
      {/* Worker status dot */}
      <div className="flex items-center gap-1.5">
        <span
          className={`h-2 w-2 rounded-full ${dotColor} ${online ? "animate-pulse" : ""}`}
        />
        <span>{statusText}</span>
      </div>

      {/* Scheduler info */}
      <span>
        Scheduler: {formatMinutes(scheduler.syncIntervalMinutes)} window · check
        every {formatMinutes(scheduler.checkIntervalMinutes)} · next check in{" "}
        {timeUntil(scheduler.nextCheckAt)}
      </span>

      {/* Job counts */}
      <span>
        {stats.pendingJobs} pending · {stats.runningJobs} running
      </span>

      {/* Stale playlist warning */}
      {scheduler.stalePlaylistCount > 0 && (
        <span className="text-amber-400">
          {scheduler.stalePlaylistCount} stale playlist
          {scheduler.stalePlaylistCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
