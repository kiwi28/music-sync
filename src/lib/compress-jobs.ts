"server-only";

import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";

// ── Types ──────────────────────────────────────────────

export type CompressJobStatus = "building" | "ready" | "cancelled" | "error";

export interface CompressJob {
  id: string;
  status: CompressJobStatus;
  totalEntries: number;
  processedEntries: number;
  archivePath: string | null;
  error: string | null;
  createdAt: number;
  abortController: AbortController;
}

// ── Store ──────────────────────────────────────────────

/** TTL for completed/cancelled/errored jobs (5 minutes) */
const JOB_TTL_MS = 5 * 60 * 1000;

const jobs = new Map<string, CompressJob>();

/** Periodic cleanup of stale jobs */
const cleanup = setInterval(() => {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.status !== "building" && job.createdAt < cutoff) {
      if (job.archivePath) unlink(job.archivePath).catch(() => {});
      jobs.delete(id);
    }
  }
}, 60_000);

// Don't let the interval keep the process alive
if (cleanup.unref) cleanup.unref();

// ── Public API ─────────────────────────────────────────

export function createJob(totalEntries: number): CompressJob {
  const id = randomUUID();
  const job: CompressJob = {
    id,
    status: "building",
    totalEntries,
    processedEntries: 0,
    archivePath: null,
    error: null,
    createdAt: Date.now(),
    abortController: new AbortController(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): CompressJob | undefined {
  return jobs.get(id);
}

export function updateProgress(id: string, processed: number): void {
  const job = jobs.get(id);
  if (job) job.processedEntries = processed;
}

export function markReady(id: string, archivePath: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "ready";
    job.archivePath = archivePath;
  }
}

export function markError(id: string, error: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "error";
    job.error = error;
  }
}

export function markCancelled(id: string): void {
  const job = jobs.get(id);
  if (job) {
    job.status = "cancelled";
    if (job.archivePath) unlink(job.archivePath).catch(() => {});
  }
}

export function removeJob(id: string): void {
  const job = jobs.get(id);
  if (job?.archivePath) unlink(job.archivePath).catch(() => {});
  jobs.delete(id);
}
