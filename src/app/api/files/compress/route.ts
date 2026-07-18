import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { compressFilesSchema } from "@/lib/validators";
import { validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import {
  createJob,
  getJob,
  updateProgress,
  markReady,
  markError,
  markCancelled,
} from "@/lib/compress-jobs";
import archiver from "archiver";
import { stat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";

// ── Helpers ────────────────────────────────────────────

/** Recursively count all files + dirs under a path for progress tracking. */
async function countEntries(rootPath: string): Promise<number> {
  let count = 0;
  const stack = [rootPath];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        count++;
        if (e.isDirectory()) stack.push(join(dir, e.name));
      }
    } catch {
      // Permission errors etc. — skip
    }
  }
  return count;
}

// ── POST: Start compression job ────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Parse body
    const body = await request.json();
    const parsed = compressFilesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Validate each path
    const safePaths: string[] = [];
    for (const p of parsed.data.paths) {
      const safe = validatePath(p);
      if (!safe) {
        return NextResponse.json(
          { error: `Path "${p}" is outside the music directory` },
          { status: 403 },
        );
      }
      try {
        await stat(safe);
      } catch {
        return NextResponse.json(
          { error: `Path "${p}" not found` },
          { status: 404 },
        );
      }
      safePaths.push(safe);
    }

    // Count total entries for progress
    let totalEntries = 0;
    for (const p of safePaths) {
      totalEntries += await countEntries(p);
    }

    // Create job
    const job = createJob(totalEntries);

    // Build archive in background
    buildArchive(job, safePaths);

    return NextResponse.json({
      jobId: job.id,
      totalEntries,
    });
  } catch (err) {
    logApiError({ route: "files/compress", step: "POST" }, err);
    return apiErrorResponse(err, "Failed to start compression");
  }
}

// ── GET: Progress or download ──────────────────────────

export async function GET(request: NextRequest) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: job.status,
      processedEntries: job.processedEntries,
      totalEntries: job.totalEntries,
      percent:
        job.totalEntries > 0
          ? Math.round((job.processedEntries / job.totalEntries) * 100)
          : 0,
      error: job.error,
    });
  } catch (err) {
    logApiError({ route: "files/compress", step: "GET" }, err);
    return apiErrorResponse(err, "Failed to get progress");
  }
}

// ── DELETE: Cancel ─────────────────────────────────────

export async function DELETE(request: NextRequest) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get("jobId");
    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    const job = getJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.status === "building") {
      job.abortController.abort();
      markCancelled(jobId);
    }

    return NextResponse.json({ status: "cancelled" });
  } catch (err) {
    logApiError({ route: "files/compress", step: "DELETE" }, err);
    return apiErrorResponse(err, "Failed to cancel");
  }
}

// ── Background archive builder ─────────────────────────

async function buildArchive(job: ReturnType<typeof createJob>, paths: string[]) {
  try {
    // Resolve path stats before starting the archive (can't await inside the stream pipeline)
    const resolved: { path: string; name: string; isDir: boolean }[] = [];
    for (const p of paths) {
      if (job.abortController.signal.aborted) return;
      const s = await stat(p).catch(() => null);
      if (s) {
        resolved.push({ path: p, name: basename(p), isDir: s.isDirectory() });
      }
    }

    if (resolved.length === 0) {
      markError(job.id, "No valid paths to compress");
      return;
    }

    // Create temp file
    const tmpPath = join(tmpdir(), `music-sync-archive-${job.id}.zip`);
    const output = createWriteStream(tmpPath);
    const archive = archiver("zip", { zlib: { level: 1 } });

    let processed = 0;

    // Track progress for every entry archiver processes
    archive.on("entry", () => {
      processed++;
      updateProgress(job.id, processed);
    });

    // Handle abort
    job.abortController.signal.addEventListener("abort", () => {
      archive.abort();
      output.close();
    });

    await new Promise<void>((resolve, reject) => {
      output.on("close", () => {
        if (job.abortController.signal.aborted) return;
        resolve();
      });

      archive.on("error", (err: Error) => reject(err));
      output.on("error", (err: NodeJS.ErrnoException) => reject(err));

      archive.pipe(output);

      for (const { path, name, isDir } of resolved) {
        if (job.abortController.signal.aborted) break;
        if (isDir) {
          archive.directory(path, name);
        } else {
          archive.file(path, { name });
        }
      }

      archive.finalize();
    });

    if (job.abortController.signal.aborted) return;

    markReady(job.id, tmpPath);
  } catch (err) {
    markError(job.id, err instanceof Error ? err.message : "Compression failed");
  }
}
