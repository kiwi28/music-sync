// Spotify playlist download handler.
// Uses spotdl to:
//   1. Fetch track metadata (via `spotdl save --save-file <tmp>.json`)
//   2. Deduplicate against existing tracks in PocketBase
//   3. Download new tracks (via `spotdl download`)
//   4. Create Track + PlaylistTrack records in PocketBase

import { execFile } from "node:child_process";
import { readFile, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { getAdminClient, withReauth } from "../pb-client.js";
import { findExistingTrack } from "../dedup.js";
import { parseFileMetadata } from "../metadata.js";
import { ensureDir, sanitizeFolderName } from "../utils.js";
import { ensureSpotifyToken } from "../spotify-token.js";

const execFileAsync = promisify(execFile);
const MUSIC_DIR = process.env.MUSIC_DIR || "/music";

/**
 * Process a Spotify playlist sync job.
 */
export async function processSpotifyJob(playlist, onProgress) {
  const pb = await getAdminClient();
  const playlistId = playlist.id;
  const url = playlist.url;

  // Ensure valid Spotify tokens are in spotdl's cache.
  // This bridges the web UI OAuth flow → spotdl automatically.
  try {
    await ensureSpotifyToken(pb);
  } catch (err) {
    throw new Error(`Spotify auth: ${err.message}`);
  }

  const outputDir = join(
    MUSIC_DIR,
    "spotify",
    sanitizeFolderName(playlist.name),
  );
  await ensureDir(outputDir);

  // Phase 1: Fetch metadata with `spotdl save`
  const metadataFile = join("/tmp", `sync_${playlistId}.spotdl.json`);
  onProgress?.(`Fetching track list from Spotify…`);
  console.log(`[spotdl] Fetching metadata for "${playlist.name}"...`);

  let saveStderr = "";
  try {
    const result = await execFileAsync("spotdl", [
      "save", url,
      "--save-file", metadataFile,
      "--user-auth",
    ], { timeout: 120_000 });
    saveStderr = result.stderr || "";
  } catch (err) {
    saveStderr = err.stderr || err.message || "";
    // Detect auth failures and give clear guidance
    if (
      saveStderr.includes("auth") ||
      saveStderr.includes("token") ||
      saveStderr.includes("login") ||
      saveStderr.includes("premium") ||
      saveStderr.includes("permission") ||
      saveStderr.includes("403") ||
      saveStderr.includes("401")
    ) {
      throw new Error(
        "Spotify authentication required. SSH into your server and run:\n" +
        `  docker compose exec worker spotdl save "${url}" --user-auth --headless\n` +
        "Then open the printed URL in your browser, log in to Spotify, and paste the redirect URL back into the terminal."
      );
    }
    console.warn(`[spotdl] save exited non-zero, checking for partial output:`, err.message);
  }

  let trackList;
  try {
    const raw = await readFile(metadataFile, "utf-8");
    trackList = JSON.parse(raw);
  } catch {
    throw new Error("spotdl failed to produce metadata — save file missing or unreadable");
  } finally {
    await unlink(metadataFile).catch(() => {});
  }

  if (!Array.isArray(trackList) || trackList.length === 0) {
    throw new Error("spotdl returned empty track list");
  }

  console.log(`[spotdl] Got metadata for ${trackList.length} tracks`);
  onProgress?.(`Found ${trackList.length} tracks, checking for new ones…`);

  // Phase 2: Dedup against PocketBase
  const existingTrackIds = [];
  const newTracks = [];

  for (const meta of trackList) {
    const isrc = meta.isrc || null;
    const platformId = meta.track_id || meta.id || null;
    const title = meta.name || meta.title || "Unknown Title";
    const artist = (meta.artists && meta.artists[0])
      || meta.artist
      || (Array.isArray(meta.artists) ? meta.artists.join(", ") : null)
      || "Unknown Artist";

    const existing = await findExistingTrack(pb, {
      isrc,
      title,
      artist,
      platform: "spotify",
      platformId,
    });

    if (existing) {
      existingTrackIds.push({
        trackId: existing.id,
        position: trackList.indexOf(meta) + 1,
      });
    } else {
      newTracks.push({
        ...meta,
        _title: title,
        _artist: artist,
        _isrc: isrc,
        _platformId: platformId,
      });
    }
  }

  console.log(`[spotdl] ${existingTrackIds.length} existing, ${newTracks.length} new (of ${trackList.length})`);
  onProgress?.(`Downloading ${newTracks.length} new tracks (${existingTrackIds.length} already synced)…`);

  // Phase 3: Download new tracks (can take 30+ minutes for large playlists)
  if (newTracks.length > 0) {
    console.log(`[spotdl] Downloading ${newTracks.length} new tracks...`);
    try {
      await execFileAsync("spotdl", [
        "download", url,
        "--output", join(outputDir, "{artist} - {title}.{output-ext}"),
        "--format", "mp3",
        "--bitrate", "320k",
        "--user-auth",
      ], { timeout: 1_800_000 });
    } catch (err) {
      const stderr = err.stderr || err.message || "";
      if (
        stderr.includes("auth") ||
        stderr.includes("token") ||
        stderr.includes("login") ||
        stderr.includes("premium") ||
        stderr.includes("permission") ||
        stderr.includes("403") ||
        stderr.includes("401")
      ) {
        throw new Error(
          "Spotify authentication expired. SSH into your server and run:\n" +
          `  docker compose exec worker spotdl save "${url}" --user-auth --headless\n` +
          "Then open the printed URL in your browser, log in to Spotify, and paste the redirect URL back."
        );
      }
      throw new Error(`spotdl download failed: ${err.message}`);
    }
  }

  // Phase 4: Create Track + PlaylistTrack records
  // Wrapped in withReauth — long downloads may cause the admin token to expire.
  onProgress?.(`Creating track records…`);
  let tracksAdded = 0;

  // Link existing tracks that aren't already linked
  for (const { trackId, position } of existingTrackIds) {
    await withReauth(async () => {
      const existingLink = await pb.collection("playlist_tracks").getList(1, 1, {
        filter: `playlist = "${playlistId}" && track = "${trackId}"`,
      });
      if (existingLink.totalItems === 0) {
        await pb.collection("playlist_tracks").create({
          playlist: playlistId,
          track: trackId,
          position,
          added_at: new Date().toISOString(),
        });
      }
    });
  }

  // Create records for new tracks
  for (const [index, meta] of newTracks.entries()) {
    // Try to read metadata from the downloaded file for richer tags
    let fileMeta = {
      title: meta._title,
      artist: meta._artist,
      album: null,
      durationMs: 0,
      isrc: meta._isrc,
    };

    try {
      const files = await readdir(outputDir);
      const match = files.find(
        (f) =>
          f.includes(meta._artist?.slice(0, 10) || "") ||
          f.includes(meta._title?.slice(0, 10) || ""),
      );
      if (match) {
        fileMeta = await parseFileMetadata(join(outputDir, match), {
          title: meta._title,
          artist: meta._artist,
          album: meta.album?.name || null,
          durationMs: Math.round((meta.duration || 0) * 1000),
          isrc: meta._isrc,
        });
      }
    } catch {
      // Fall back to spotdl metadata (already set in fileMeta defaults)
    }

    await withReauth(async () => {
      // Create track record
      const track = await pb.collection("tracks").create({
        title: fileMeta.title,
        artist: fileMeta.artist,
        album: meta.album?.name || fileMeta.album || null,
        platform: "spotify",
        platform_id: meta._platformId || meta.track_id || "",
        duration_ms: fileMeta.durationMs || Math.round((meta.duration || 0) * 1000),
        isrc: fileMeta.isrc || null,
        cover_url: meta.cover_url || meta.cover?.url || null,
      });

      // Create playlist_track relation
      await pb.collection("playlist_tracks").create({
        playlist: playlistId,
        track: track.id,
        position: trackList.indexOf(meta) + 1,
        added_at: new Date().toISOString(),
      });

      tracksAdded++;
    });
  }

  return {
    tracksAdded,
    totalTracks: trackList.length,
  };
}
