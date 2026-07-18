import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { getJob, removeJob } from "@/lib/compress-jobs";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";

/**
 * GET /api/files/compress/download?jobId=...
 *
 * Streams the completed ZIP archive for download.
 * Cleans up the temp file after sending.
 */
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
    if (!job || job.status !== "ready" || !job.archivePath) {
      return NextResponse.json(
        { error: "Archive not ready or not found" },
        { status: 404 },
      );
    }

    // Read the archive into memory and send it
    const buffer = await readFile(job.archivePath);
    const fileStat = await stat(job.archivePath);

    // Clean up temp file and job
    removeJob(jobId);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="archive.zip"',
        "Content-Length": String(fileStat.size),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    logApiError({ route: "files/compress/download", step: "GET" }, err);
    return apiErrorResponse(err, "Download failed");
  }
}
