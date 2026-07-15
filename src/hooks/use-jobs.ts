"use client";

import { useState, useEffect, useCallback } from "react";
import type { SyncJob } from "@/lib/types";
import { useAuth } from "@/components/layout/providers";

interface JobsFilters {
  status?: string;
  playlistId?: string;
  page?: number;
  perPage?: number;
}

interface JobsResponse {
  items: SyncJob[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

/**
 * Fetch paginated, filterable sync jobs for the current user.
 * Calls GET /api/jobs with query params.
 */
export function useJobs(filters: JobsFilters = {}) {
  const { user } = useAuth();
  const [data, setData] = useState<JobsResponse>({
    items: [],
    page: 1,
    perPage: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setData({
        items: [],
        page: 1,
        perPage: 20,
        totalItems: 0,
        totalPages: 0,
      });
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.playlistId) params.set("playlistId", filters.playlistId);
      params.set("page", String(filters.page || 1));
      params.set("perPage", String(filters.perPage || 20));

      const res = await fetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load jobs",
      );
    } finally {
      setLoading(false);
    }
  }, [
    user,
    filters.status,
    filters.playlistId,
    filters.page,
    filters.perPage,
  ]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return { ...data, loading, error, refetch: fetchJobs };
}

// ── Worker Status ──

interface WorkerStatus {
  online: boolean;
  lastPollAt: string | null;
  lastPollSecondsAgo: number | null;
  scheduler: {
    lastCheckAt: string | null;
    nextCheckAt: string | null;
    syncIntervalMinutes: number | null;
    checkIntervalMinutes: number | null;
    stalePlaylistCount: number;
  };
  stats: {
    pendingJobs: number;
    runningJobs: number;
  };
}

/**
 * Poll GET /api/worker/status every 30s.
 * Returns worker health, scheduler info, and job counts.
 */
export function useWorkerStatus() {
  const [status, setStatus] = useState<WorkerStatus>({
    online: false,
    lastPollAt: null,
    lastPollSecondsAgo: null,
    scheduler: {
      lastCheckAt: null,
      nextCheckAt: null,
      syncIntervalMinutes: null,
      checkIntervalMinutes: null,
      stalePlaylistCount: 0,
    },
    stats: { pendingJobs: 0, runningJobs: 0 },
  });
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/worker/status");
      if (res.ok) {
        const json = await res.json();
        setStatus(json);
      }
    } catch {
      setStatus((prev) => ({ ...prev, online: false }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { ...status, loading, refetch: fetchStatus };
}

// ── Job Action Helpers ──

/** Cancel a running/pending job. */
export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to cancel job");
  }
}

/** Delete a terminal job. */
export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to delete job");
  }
}

/** Retry a job — creates a new pending job for the same playlist. */
export async function retryJob(jobId: string): Promise<SyncJob> {
  const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to retry job");
  }
  return res.json();
}
