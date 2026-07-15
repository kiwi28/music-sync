"use client";

import { useState, useCallback, Suspense } from "react";
import { useJobs, cancelJob, deleteJob, retryJob } from "@/hooks/use-jobs";
import { JobRow, JobRowSkeleton } from "@/components/jobs/job-row";
import { WorkerStatusBar } from "@/components/jobs/worker-status-bar";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
] as const;

function JobsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(
    searchParams.get("status") || "",
  );
  const [page, setPage] = useState(1);
  const highlightId = searchParams.get("highlight");
  const playlistId = searchParams.get("playlistId");

  const { items, totalItems, totalPages, loading, error, refetch } = useJobs({
    status: statusFilter || undefined,
    playlistId: playlistId || undefined,
    page,
    perPage: 20,
  });

  const handleAction = useCallback(
    async (action: string, jobId: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        refetch();
      } catch (err) {
        console.error(`[JobsPage] ${action} failed:`, err);
      }
    },
    [refetch],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sync Jobs</h1>
          <p className="mt-1 text-sm text-white/40">
            {totalItems} job{totalItems !== 1 ? "s" : ""} total
          </p>
        </div>
      </div>

      {/* Worker health bar */}
      <WorkerStatusBar />

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setStatusFilter(tab.value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-white/10 text-white"
                : "text-white/40 hover:bg-white/5 hover:text-white/60"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={refetch}>
            Retry
          </Button>
        </div>
      )}

      {/* Job list */}
      <div className="space-y-2">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <JobRowSkeleton key={i} />
            ))
          : items.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                isHighlighted={job.id === highlightId}
                onCancel={(id) =>
                  handleAction("cancel", id, () => cancelJob(id))
                }
                onRetry={(id) =>
                  handleAction("retry", id, async () => {
                    await retryJob(id);
                    router.refresh();
                  })
                }
                onDelete={(id) =>
                  handleAction("delete", id, () => deleteJob(id))
                }
              />
            ))}
      </div>

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-sm text-white/40">No sync jobs found</p>
          <p className="mt-1 text-xs text-white/25">
            {statusFilter
              ? `No jobs with status "${statusFilter}"`
              : "Sync a playlist to see its job here"}
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </Button>
          <span className="text-xs text-white/40">
            {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-8 w-1/3 animate-pulse rounded bg-white/5" />
          <div className="h-10 animate-pulse rounded bg-white/5" />
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <JobRowSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <JobsContent />
    </Suspense>
  );
}
