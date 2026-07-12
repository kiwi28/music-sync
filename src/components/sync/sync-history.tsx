"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import type { SyncJob } from "@/lib/types";

const STATUS_BADGE: Record<string, { variant: "success" | "warning" | "danger" | "default"; label: string }> = {
  completed: { variant: "success", label: "Done" },
  running: { variant: "warning", label: "Running" },
  pending: { variant: "default", label: "Queued" },
  failed: { variant: "danger", label: "Failed" },
};

interface SyncHistoryProps {
  jobs: SyncJob[];
  loading?: boolean;
}

export function SyncHistory({ jobs, loading }: SyncHistoryProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Syncs</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-white/5" />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <p className="py-6 text-center text-sm text-white/40">
            No sync history yet. Add a playlist and sync it to get started.
          </p>
        ) : (
          <div className="space-y-2">
            {jobs.map((job) => {
              const status = STATUS_BADGE[job.status] ?? STATUS_BADGE.failed;
              return (
                <div
                  key={job.id}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2.5"
                >
                  <Badge variant={status.variant}>{status.label}</Badge>
                  <span className="flex-1 text-sm font-medium truncate">
                    {job.expand?.playlist?.name ?? "Unknown playlist"}
                  </span>
                  <span className="text-xs text-white/30 tabular-nums">
                    {job.started_at ? timeAgo(job.started_at) : "—"}
                  </span>
                  {job.tracks_added != null && job.tracks_added > 0 && (
                    <span className="text-xs text-green-400 tabular-nums">
                      +{job.tracks_added}
                    </span>
                  )}
                  {job.tracks_removed != null && job.tracks_removed > 0 && (
                    <span className="text-xs text-red-400 tabular-nums">
                      -{job.tracks_removed}
                    </span>
                  )}
                  {job.error && (
                    <span className="max-w-[120px] truncate text-xs text-red-400">
                      {job.error}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
