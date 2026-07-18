import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { compressFilesSchema } from "@/lib/validators";
import { validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import {
  createJob,
  getJobForUser,
  updateProgress,
  markReady,
  markError,
  markCancelled,
} from "@/lib/compress-jobs";
import archiver from "archiver";
import { stat, readdir, open } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

// ── Helpers ────────────────────────────────────────────

interface FlatEntry {
  /** Absolute path on disk. */
  diskPath: string;
  /** Path inside the zip archive (relative to the zip root). */
  archivePath: string;
  size: number;
}

/** Recursively walk a directory and return a flat list of every file. */
async function walkFiles(
  rootPath: string,
  archiveRoot: string,
): Promise<FlatEntry[]> {
  const result: FlatEntry[] = [];
  const stack: Array<{ diskPath: string; archivePath: string }> = [
    { diskPath: rootPath, archivePath: archiveRoot },
  ];

  while (stack.length > 0) {
    const { diskPath, archivePath } = stack.pop()!;
    let entries;
    try {
      entries = await readdir(diskPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const childDisk = join(diskPath, e.name);
      const childArchive = `${archivePath}/${e.name}`;

      if (e.isDirectory()) {
        stack.push({ diskPath: childDisk, archivePath: childArchive });
      } else if (e.isFile()) {
        const s = await stat(childDisk).catch(() => null);
        if (s) {
          result.push({ diskPath: childDisk, archivePath: childArchive, size: s.size });
        }
      }
    }
  }

  return result;
}

// ── POST: Start compression job ────────────────────────

export async function POST(request: NextRequest) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = compressFilesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Validate paths
    const safePaths: string[] = [];
    for (const p of parsed.data.paths) {
      const safe = validatePath(p);
      if (!safe) {
        return NextResponse.json(
          { error: `Path "${p}" is outside the music directory` },
          { status: 403 },
        );
      }
      try { await stat(safe); } catch {
        return NextResponse.json({ error: `Path "${p}" not found` }, { status: 404 });
      }
      safePaths.push(safe);
    }

    // Walk all paths to get a flat file list + count
    let allFiles: FlatEntry[] = [];
    for (const p of safePaths) {
      const s = await stat(p);
      if (s.isDirectory()) {
        const files = await walkFiles(p, basename(p));
        allFiles = allFiles.concat(files);
      } else {
        allFiles.push({ diskPath: p, archivePath: basename(p), size: s.size });
      }
    }

    if (allFiles.length === 0) {
      return NextResponse.json({ error: "No files to compress" }, { status: 400 });
    }

    const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);

    // Create job — total = file count for progress granularity
    const job = createJob(allFiles.length, totalBytes, pb.authStore.record.id);

    // Build archive in background
    buildArchive(job, allFiles);

    return NextResponse.json({
      jobId: job.id,
      totalFiles: allFiles.length,
      totalBytes,
    });
  } catch (err) {
    logApiError({ route: "files/compress", step: "POST" }, err);
    return apiErrorResponse(err, "Failed to start compression");
  }
}

// ── GET: Progress ──────────────────────────────────────

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

    const job = getJobForUser(jobId, pb.authStore.record.id);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      status: job.status,
      filesProcessed: job.filesProcessed,
      totalFiles: job.totalFiles,
      totalBytes: job.totalBytes,
      percent: job.totalFiles > 0
        ? Math.round((job.filesProcessed / job.totalFiles) * 100)
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

    const job = getJobForUser(jobId, pb.authStore.record.id);
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

async function buildArchive(
  job: ReturnType<typeof createJob>,
  allFiles: FlatEntry[],
) {
  try {
    // Create temp file (owner-only)
    const tmpPath = join(tmpdir(), `music-sync-archive-${job.id}.zip`);
    let fileHandle;
    try {
      fileHandle = await open(
        tmpPath,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        0o600,
      );
    } catch {
      markError(job.id, "Failed to create temporary file");
      return;
    }
    const output = fileHandle.createWriteStream();
    const archive = archiver("zip", { zlib: { level: 1 } });

    // Handle abort
    job.abortController.signal.addEventListener("abort", () => {
      archive.abort();
      output.close();
    });

    // Pipe archive → output
    archive.pipe(output);

    // Track entry events: archiver fires one per file appended
    let fileCount = 0;
    archive.on("entry", () => {
      fileCount++;
      updateProgress(job.id, fileCount);
    });

    // Add files one at a time with a micro-yield between each.
    // archive.append() queues the file and returns immediately — archiver
    // handles streaming in the background, so we don't block on each read.
    for (const f of allFiles) {
      if (job.abortController.signal.aborted) break;

      const stream = createReadStream(f.diskPath);
      stream.on("error", () => {
        // If a file can't be read, skip it silently — archiver will
        // see the error on the stream and skip the entry.
      });
      archive.append(stream, { name: f.archivePath });

      // Yield the event loop so pending polls can observe progress.
      // This costs ~μs per file but guarantees visible increments.
      await new Promise((r) => setImmediate(r));
    }

    if (job.abortController.signal.aborted) return;

    // Finalize the archive (writes central directory)
    await new Promise<void>((resolve, reject) => {
      output.on("close", () => {
        if (job.abortController.signal.aborted) return;
        resolve();
      });
      output.on("error", reject);
      archive.on("error", reject);
      archive.finalize();
    });

    if (job.abortController.signal.aborted) return;

    markReady(job.id, tmpPath);
  } catch (err) {
    markError(
      job.id,
      err instanceof Error ? err.message : "Compression failed",
    );
  }
}
