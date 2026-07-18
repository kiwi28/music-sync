import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import {
  createFolder,
  generateM3u,
  getPlaylistDir,
  getPlaylistDirFromRecord,
  sanitizeFolderName,
} from "@/lib/files";
import { writeFile } from "node:fs/promises";
import { join, parse } from "node:path";

/** Maximum upload size: 500 MB per file */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

/** Allowed audio MIME types */
const ALLOWED_MIME_TYPES = new Set([
  "audio/mpeg",         // .mp3
  "audio/mp4",          // .m4a
  "audio/flac",         // .flac
  "audio/ogg",          // .ogg
  "audio/wav",          // .wav
  "audio/x-wav",
  "audio/wave",
  "audio/webm",         // .weba
  "audio/x-flac",
  "audio/opus",         // .opus
  "audio/aac",          // .aac
  "audio/x-m4a",
  "application/octet-stream", // generic — allow with audio extensions
]);

/** Audio file extensions */
const AUDIO_EXTS = new Set([
  ".mp3", ".flac", ".m4a", ".ogg", ".wav", ".opus", ".m4b", ".aac", ".weba",
]);

function hasAudioExtension(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return false;
  return AUDIO_EXTS.has(filename.slice(dot).toLowerCase());
}

/**
 * Parse artist/title from a filename.
 * Handles common patterns like "Artist - Title.mp3" or "01 - Title.mp3".
 */
function parseFilename(filename: string): { title: string; artist: string } {
  const { name } = parse(filename);

  // Try "Artist - Title" pattern
  const dashIdx = name.indexOf(" - ");
  if (dashIdx !== -1) {
    const artist = name.slice(0, dashIdx).trim();
    const title = name.slice(dashIdx + 3).trim();
    // If the artist portion looks like a track number (digits only), treat as title-only
    if (/^\d+$/.test(artist)) {
      return { title, artist: "Unknown Artist" };
    }
    return { title, artist };
  }

  // No dash — use whole name as title
  return { title: name.trim() || "Unknown Track", artist: "Unknown Artist" };
}

/**
 * POST /api/files/upload
 *
 * Uploads one or more audio files to a playlist directory.
 * Creates PocketBase records for tracks and playlist_tracks.
 * Regenerates M3U on completion.
 *
 * FormData fields:
 *   files: File | File[]  — audio files
 *   playlistId?: string   — add to existing playlist
 *   newPlaylistName?: string — create a new playlist
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // ── Parse FormData ──
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];
    const playlistId = (formData.get("playlistId") as string) || null;
    const newPlaylistName = (formData.get("newPlaylistName") as string) || null;

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    if (!playlistId && !newPlaylistName) {
      return NextResponse.json(
        { error: "Either playlistId or newPlaylistName is required" },
        { status: 400 },
      );
    }

    // ── Validate each file ──
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds 500 MB limit` },
          { status: 400 },
        );
      }
    }

    // ── Determine target directory and playlist ──
    let dirPath: string;
    let targetPlaylistId: string;
    let targetPlaylistName: string;
    let platform: string;

    if (playlistId) {
      // Existing playlist
      let playlistRecord;
      try {
        playlistRecord = await pb.collection("playlists").getOne(playlistId);
        if (playlistRecord.user !== userId) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
      }

      const playlist = { platform: (playlistRecord as Record<string, unknown>).platform as string || "local", name: (playlistRecord as Record<string, unknown>).name as string };
      dirPath = getPlaylistDirFromRecord(playlist);
      targetPlaylistId = playlistRecord.id;
      targetPlaylistName = playlist.name;
      platform = playlist.platform;
    } else {
      // New playlist
      const name = newPlaylistName!.trim();
      if (!name || name.length > 200) {
        return NextResponse.json(
          { error: "Playlist name must be 1-200 characters" },
          { status: 400 },
        );
      }
      platform = "local";

      // Create the PocketBase playlist record
      const newPlaylist = await pb.collection("playlists").create({
        user: userId,
        name,
        platform,
        track_count: 0,
      });

      dirPath = getPlaylistDir(platform, name);
      targetPlaylistId = newPlaylist.id;
      targetPlaylistName = name;
    }

    // ── Ensure directory exists ──
    await createFolder(dirPath);

    // ── Write files and create PocketBase records ──
    let tracksAdded = 0;
    let otherFiles = 0;

    for (const file of files) {
      try {
        // Write file to disk
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        const filePath = join(dirPath, file.name);
        await writeFile(filePath, fileBuffer);

        const isAudio =
          ALLOWED_MIME_TYPES.has(file.type) || hasAudioExtension(file.name);

        if (!isAudio) {
          // Non-audio file — just write to disk, skip track creation
          otherFiles++;
          continue;
        }

        // Parse metadata from filename
        const { title, artist } = parseFilename(file.name);

        // Create track record in PocketBase
        const track = await pb.collection("tracks").create({
          title,
          artist,
          platform,
          platform_id: `local:${sanitizeFolderName(file.name)}:${Date.now()}`,
          album: targetPlaylistName,
        });

        // Determine position for the new track
        const existingLinks = await pb
          .collection("playlist_tracks")
          .getList(1, 1, {
            filter: `playlist = "${targetPlaylistId}"`,
            sort: "-position",
          });
        const nextPosition =
          existingLinks.items.length > 0
            ? ((existingLinks.items[0] as Record<string, unknown>).position as number) + 1
            : 1;

        // Link track to playlist
        await pb.collection("playlist_tracks").create({
          playlist: targetPlaylistId,
          track: track.id,
          position: nextPosition,
          added_at: new Date().toISOString(),
        });

        tracksAdded++;
      } catch (err) {
        console.error(
          `[upload] Failed to process "${file.name}":`,
          (err as Error).message,
        );
        // Continue with remaining files — don't fail the whole batch
      }
    }

    // ── Update playlist track count ──
    if (tracksAdded > 0) {
      await pb.collection("playlists").update(targetPlaylistId, {
        track_count: { $inc: tracksAdded },
        last_synced: new Date().toISOString(),
      });
    }

    // ── Regenerate M3U (only if audio tracks were added) ──
    if (tracksAdded > 0) {
      await generateM3u(dirPath, targetPlaylistName);
    }

    return NextResponse.json({
      success: true,
      playlistId: targetPlaylistId,
      tracksAdded,
      otherFiles,
    });
  } catch (err) {
    logApiError({ route: "files/upload", step: "POST" }, err);
    return apiErrorResponse(err, "Upload failed");
  }
}
