import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { browseFilesSchema } from "@/lib/validators";
import { listDirectory, MUSIC_ROOT } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import { join } from "node:path";

/**
 * GET /api/files/browse?path=/spotify/My%20Playlist
 *
 * Lists the contents of a directory under the music root.
 * Returns directories first, then files, both sorted alphabetically.
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // ── Parse query ──
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get("path") || "/";

    const parsed = browseFilesSchema.safeParse({ path: rawPath });
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid path", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // Build the absolute path — listDirectory handles validation internally
    const dirPath = rawPath === "/" ? MUSIC_ROOT : join(MUSIC_ROOT, rawPath);

    const entries = await listDirectory(dirPath);

    // Return paths relative to MUSIC_ROOT for the client
    const relativeEntries = entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory,
      size: e.size,
      ext: e.ext,
    }));

    return NextResponse.json({ path: rawPath, entries: relativeEntries });
  } catch (err) {
    logApiError({ route: "files/browse", step: "GET" }, err);
    return apiErrorResponse(err, "Failed to browse directory");
  }
}
