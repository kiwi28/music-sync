import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import { access, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";

/** Map file extensions to MIME types for Content-Type headers. */
const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".opus": "audio/opus",
  ".aac": "audio/aac",
  ".weba": "audio/webm",
  ".m4b": "audio/mp4",
  ".m3u": "audio/x-mpegurl",
  ".m3u8": "application/vnd.apple.mpegurl",
};

function getMimeType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_TYPES[filename.slice(dot).toLowerCase()] || "application/octet-stream";
}

/**
 * GET /api/files/download?path=...
 *
 * Streams a file from the music directory for browser download.
 * Only serves files (not directories), and only from within MUSIC_ROOT.
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // ── Parse path ──
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    }

    // ── Validate path ──
    const safePath = validatePath(path);
    if (!safePath) {
      return NextResponse.json(
        { error: "Path is outside the music directory" },
        { status: 403 },
      );
    }

    // ── Ensure it's a file (not a directory) ──
    let fileStat;
    try {
      fileStat = await stat(safePath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (fileStat.isDirectory()) {
      return NextResponse.json(
        { error: "Cannot download a directory" },
        { status: 400 },
      );
    }

    // ── Stream the file ──
    const filename = basename(safePath);
    const mimeType = getMimeType(filename);
    const fileSize = fileStat.size;

    // Read the file into a buffer so we can set Content-Length.
    // For very large files we'd stream, but music files are typically
    // 3–50 MB which fits comfortably in the container's memory.
    const { readFile } = await import("node:fs/promises");
    const buffer = await readFile(safePath);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(fileSize),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (err) {
    logApiError({ route: "files/download", step: "GET" }, err);
    return apiErrorResponse(err, "Download failed");
  }
}
