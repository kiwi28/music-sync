"use client";

import Link from "next/link";
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
        <div className="flex items-center justify-between">
          <CardTitle>Recent Syncs</CardTitle>
          {jobs.length > 0 && (
            <Link
              href="/jobs"
              className="text-xs text-white/40 underline underline-offset-4 hover:text-white/70"
            >
              View all
            </Link>
          )}
        </div>
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
                <Link
                  key={job.id}
                  href={`/jobs?highlight=${job.id}`}
                  className="block rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-center gap-3">
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
                    {(job.failed_count ?? 0) > 0 && (
                      <span className="text-xs text-amber-400 tabular-nums">
                        ⚠ {job.failed_count}
                      </span>
                    )}
                  </div>
                  {(job.log || job.error) && (
                    <div className="mt-1.5 border-t border-white/5 pt-1.5">
                      {job.log && (
                        <p className="text-xs text-white/50">{job.log}</p>
                      )}
                      {job.error && (
                        <p className="text-xs text-red-400">{job.error}</p>
                      )}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
