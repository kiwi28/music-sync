"use client";

import { useState } from "react";
import type { SyncJob } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORM_META, timeAgo } from "@/lib/utils";
import Link from "next/link";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_CONFIG: Record<
  string,
  {
    variant: "success" | "warning" | "danger" | "default";
    label: string;
    icon: string;
  }
> = {
  completed: { variant: "success", label: "Completed", icon: "✓" },
  running: { variant: "warning", label: "Running", icon: "●" },
  pending: { variant: "default", label: "Queued", icon: "○" },
  failed: { variant: "danger", label: "Failed", icon: "✗" },
};

interface JobRowProps {
  job: SyncJob;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  isHighlighted?: boolean;
}

export function JobRow({
  job,
  onCancel,
  onRetry,
  onDelete,
  isHighlighted,
}: JobRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const status = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.failed;
  const playlistName = job.expand?.playlist?.name ?? "Unknown playlist";
  const platform = job.expand?.playlist?.platform;
  const meta = platform ? PLATFORM_META[platform] : null;

  async function handleAction(action: string, fn: () => Promise<void>) {
    setActionLoading(action);
    try {
      await fn();
    } catch (err) {
      console.error(`[JobRow] ${action} failed:`, err);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${
        isHighlighted
          ? "border-white/20 bg-white/10"
          : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Status badge */}
        <Badge variant={status.variant}>
          <span className="mr-1">{status.icon}</span>
          {status.label}
        </Badge>

        {/* Playlist name */}
        <Link
          href={`/playlists/${job.playlist}`}
          className="flex-1 truncate text-sm font-medium hover:text-white/80"
        >
          {playlistName}
        </Link>

        {/* Platform */}
        {meta && (
          <span className="flex items-center gap-1 text-xs text-white/40">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />
            {meta.label}
          </span>
        )}

        {/* Time */}
        <span className="whitespace-nowrap text-xs text-white/30 tabular-nums">
          {job.started_at
            ? timeAgo(job.started_at)
            : job.created
              ? timeAgo(job.created)
              : "—"}
        </span>

        {/* Tracks added */}
        {job.tracks_added != null && job.tracks_added > 0 && (
          <span className="whitespace-nowrap text-xs text-green-400 tabular-nums">
            +{job.tracks_added}
          </span>
        )}

        {/* Expand toggle */}
        {(job.log || job.error) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-white/30 hover:text-white/60"
            aria-label={expanded ? "Collapse log" : "Expand log"}
          >
            {expanded ? (
              <ChevronUp size={14} />
            ) : (
              <ChevronDown size={14} />
            )}
          </button>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-1.5">
          {(job.status === "pending" || job.status === "running") && (
            <Button
              size="sm"
              variant="ghost"
              disabled={actionLoading === "cancel"}
              onClick={() =>
                handleAction("cancel", () => onCancel(job.id))
              }
              className="h-7 text-xs text-red-400 hover:text-red-300"
            >
              {actionLoading === "cancel" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                "Cancel"
              )}
            </Button>
          )}
          {(job.status === "failed" || job.status === "completed") && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={actionLoading === "retry"}
                onClick={() =>
                  handleAction("retry", () => onRetry(job.id))
                }
                className="h-7 text-xs"
              >
                {actionLoading === "retry" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  "Retry"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={actionLoading === "delete"}
                onClick={() =>
                  handleAction("delete", () => onDelete(job.id))
                }
                className="h-7 text-xs text-white/30 hover:text-red-400"
              >
                {actionLoading === "delete" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Expandable log/error */}
      {expanded && (job.log || job.error) && (
        <div className="mt-2 border-t border-white/5 pt-2">
          {job.log && (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-xs text-white/50">
              {job.log}
            </pre>
          )}
          {job.error && (
            <p className="mt-1 text-xs text-red-400">{job.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function JobRowSkeleton() {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-5 w-16 animate-pulse rounded bg-white/5" />
        <div className="h-4 flex-1 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-16 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-20 animate-pulse rounded bg-white/5" />
      </div>
    </div>
  );
}
