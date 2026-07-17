import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { refreshM3uSchema } from "@/lib/validators";
import { generateM3u, getPlaylistDirFromRecord, validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/files/m3u
 *
 * Regenerates the .m3u file for a given playlist directory.
 * Can be called with either a `playlistId` (fetches playlist from PB)
 * or a raw `path` (direct filesystem path under MUSIC_ROOT).
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // ── Parse body ──
    const body = await request.json();
    const parsed = refreshM3uSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    let dirPath: string;
    let playlistName: string;

    if (parsed.data.playlistId) {
      // Fetch playlist from PocketBase (ownership check)
      let playlistRecord;
      try {
        playlistRecord = await pb.collection("playlists").getOne(parsed.data.playlistId);
        if (playlistRecord.user !== userId) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
      }

      const playlist = { platform: playlistRecord.platform as string, name: playlistRecord.name as string };
      dirPath = getPlaylistDirFromRecord(playlist);
      playlistName = playlist.name;
    } else {
      // Direct path mode (from the file browser)
      const safePath = validatePath(parsed.data.path!);
      if (!safePath) {
        return NextResponse.json(
          { error: "Path is outside the music directory" },
          { status: 400 },
        );
      }
      dirPath = safePath;
      // Use the last path segment as the playlist name
      const segments = parsed.data.path!.replace(/\\/g, "/").split("/").filter(Boolean);
      playlistName = segments[segments.length - 1] || "playlist";
    }

    const trackCount = await generateM3u(dirPath, playlistName);

    return NextResponse.json({ success: true, trackCount });
  } catch (err) {
    logApiError({ route: "files/m3u", step: "POST" }, err);
    return apiErrorResponse(err, "Failed to refresh M3U");
  }
}
