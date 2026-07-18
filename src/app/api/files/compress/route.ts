import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { compressFilesSchema } from "@/lib/validators";
import { validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import archiver from "archiver";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { PassThrough } from "node:stream";

/**
 * POST /api/files/compress
 *
 * Accepts an array of file/folder paths, creates a streaming ZIP archive,
 * and returns it as a download. Directories are included recursively.
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // ── Parse body ──
    const body = await request.json();
    const parsed = compressFilesSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // ── Validate each path ──
    const safePaths: string[] = [];
    for (const p of parsed.data.paths) {
      const safe = validatePath(p);
      if (!safe) {
        return NextResponse.json(
          { error: `Path "${p}" is outside the music directory` },
          { status: 403 },
        );
      }
      // Verify the path exists before queuing it for the archive
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

    // ── Create streaming archive ──
    // level 1 = fastest compression. Audio files are already compressed,
    // so higher levels waste CPU for negligible size reduction.
    const archive = archiver("zip", { zlib: { level: 1 } });
    const passThrough = new PassThrough();

    archive.pipe(passThrough);

    for (const safePath of safePaths) {
      const s = await stat(safePath);
      const name = basename(safePath);
      if (s.isDirectory()) {
        archive.directory(safePath, name);
      } else {
        archive.file(safePath, { name });
      }
    }

    // Finalize signals archiver that no more data is coming.
    // The archive stream will emit "end" once all data is flushed.
    archive.finalize();

    // ── Convert Node.js stream to Web API ReadableStream ──
    const webStream = new ReadableStream({
      start(controller) {
        passThrough.on("data", (chunk: Buffer) => {
          controller.enqueue(chunk);
        });
        passThrough.on("end", () => controller.close());
        passThrough.on("error", (err: Error) => controller.error(err));
      },
      cancel() {
        archive.abort();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="archive.zip"',
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    logApiError({ route: "files/compress", step: "POST" }, err);
    return apiErrorResponse(err, "Compression failed");
  }
}
