// YouTube Music playlist download handler.
// Uses yt-dlp to:
//   1. Fetch playlist metadata (via `yt-dlp --flat-playlist --dump-json`)
//   2. Deduplicate against existing tracks in PocketBase
//   3. Download as MP3 (via `yt-dlp -x --audio-format mp3`)
//   4. Extract metadata from downloaded files with ffprobe
//   5. Create Track + PlaylistTrack records in PocketBase

import { execFile } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { promisify } from "node:util";

import { getAdminClient, withReauth } from "../pb-client.js";
import { findExistingTrack } from "../dedup.js";
import { parseFileMetadata } from "../metadata.js";
import { ensureDir, sanitizeFolderName, generateM3u } from "../utils.js";

const execFileAsync = promisify(execFile);
const MUSIC_DIR = process.env.MUSIC_DIR || "/music";

/**
 * Process a YouTube Music playlist sync job.
 */
export async function processYoutubeMusicJob(playlist, onProgress) {
  const pb = await getAdminClient();
  const playlistId = playlist.id;
  const url = playlist.url;

  const outputDir = join(
    MUSIC_DIR,
    "youtube_music",
    sanitizeFolderName(playlist.name),
  );
  await ensureDir(outputDir);

  // Phase 1: Fetch playlist metadata
  onProgress?.(`Fetching track list from YouTube Music…`);
  console.log(`[yt-dlp] Fetching playlist metadata for "${playlist.name}"...`);

  let rawEntries;
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "--flat-playlist",
      "--dump-json",
      "--no-warnings",
      url,
    ], { timeout: 120_000 });

    // yt-dlp --dump-json outputs one JSON object per line
    rawEntries = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (err) {
    throw new Error(`yt-dlp metadata fetch failed: ${err.message}`);
  }

  if (!rawEntries.length) {
    throw new Error("yt-dlp returned empty playlist");
  }

  console.log(`[yt-dlp] Got metadata for ${rawEntries.length} tracks`);
  onProgress?.(`Found ${rawEntries.length} tracks, checking for new ones…`);

  // Transform entries into a consistent shape
  const trackList = rawEntries.map((entry, index) => ({
    _index: index + 1,
    _videoId: entry.id,
    _title: entry.title || "Unknown Title",
    _artist: entry.channel || entry.uploader || entry.artist || "Unknown Artist",
    _album: entry.album || null,
    _durationMs: Math.round((entry.duration || 0) * 1000),
    _url: entry.webpage_url || entry.url || `https://youtube.com/watch?v=${entry.id}`,
  }));

  // Phase 2: Dedup against PocketBase
  const existingTrackIds = [];
  const newTracks = [];

  for (const meta of trackList) {
    const existing = await findExistingTrack(pb, {
      isrc: null, // yt-dlp flat playlist doesn't include ISRC
      title: meta._title,
      artist: meta._artist,
      platform: "youtube_music",
      platformId: meta._videoId,
    });

    if (existing) {
      existingTrackIds.push({
        trackId: existing.id,
        position: meta._index,
      });
    } else {
      newTracks.push(meta);
    }
  }

  console.log(`[yt-dlp] ${existingTrackIds.length} existing, ${newTracks.length} new (of ${trackList.length})`);
  onProgress?.(`Downloading ${newTracks.length} new tracks (${existingTrackIds.length} already synced)…`);

  // Phase 3: Download all tracks as MP3
  if (newTracks.length > 0) {
    console.log(`[yt-dlp] Downloading ${newTracks.length} tracks as MP3...`);
    try {
      await execFileAsync("yt-dlp", [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-f", "bestaudio",
        "--embed-metadata",
        "--embed-thumbnail",
        "--no-write-thumbnail",
        "--concurrent-fragments", "1",
        "--sleep-requests", "1",
        "--sleep-interval", "3",
        "--max-sleep", "8",
        "-o", join(outputDir, "%(playlist_index)02d - %(title)s.%(ext)s"),
        url,
      ], { timeout: 7_200_000 }); // 2h timeout for large playlists
    } catch (err) {
      throw new Error(`yt-dlp download failed: ${err.message}`);
    }

    // Clean up leftover files — yt-dlp sometimes leaves .webm (failed conversion)
    // and .webp/.jpg thumbnails when embed processing doesn't clean up.
    try {
      const allFiles = await readdir(outputDir);
      for (const file of allFiles) {
        const ext = extname(file).toLowerCase();
        if (ext === ".webm" || ext === ".webp" || ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
          await unlink(join(outputDir, file));
          console.log(`[yt-dlp] Cleaned up leftover: ${file}`);
        }
      }
    } catch {
      // Non-critical — cleanup failure shouldn't fail the job
    }
  }

  // Phase 4: Create Track + PlaylistTrack records
  onProgress?.(`Creating track records…`);
  let tracksAdded = 0;

  // Link existing tracks — wrapped in withReauth for token expiry during long downloads
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

  // Create records for new tracks — read metadata from downloaded files
  let downloadedFiles;
  try {
    downloadedFiles = (await readdir(outputDir))
      .filter((f) => f.endsWith(".mp3"))
      .sort();
  } catch {
    downloadedFiles = [];
  }

  for (const meta of newTracks) {
    // Find the matching downloaded file (by index prefix or title)
    const fileMatch = downloadedFiles.find(
      (f) =>
        f.startsWith(String(meta._index).padStart(2, "0")) ||
        f.includes(meta._title?.slice(0, 20) || ""),
    );

    let fileMeta = {
      title: meta._title,
      artist: meta._artist,
      album: meta._album,
      durationMs: meta._durationMs,
      isrc: null,
    };
    if (fileMatch) {
      fileMeta = await parseFileMetadata(join(outputDir, fileMatch), {
        title: meta._title,
        artist: meta._artist,
        album: meta._album,
        durationMs: meta._durationMs,
        isrc: null,
      });
    }

    // Create track + playlist_track records wrapped in withReauth
    // to handle token expiry during long downloads (30+ min).
    await withReauth(async () => {
      const track = await pb.collection("tracks").create({
        title: fileMeta.title,
        artist: fileMeta.artist,
        album: fileMeta.album || null,
        platform: "youtube_music",
        platform_id: meta._videoId,
        duration_ms: fileMeta.durationMs || meta._durationMs,
        isrc: fileMeta.isrc || null,
      });

      await pb.collection("playlist_tracks").create({
        playlist: playlistId,
        track: track.id,
        position: meta._index,
        added_at: new Date().toISOString(),
      });
    });

    tracksAdded++;
  }

  // Generate .m3u playlist file for Navidrome local import
  await generateM3u(outputDir, playlist.name);

  return {
    tracksAdded,
    totalTracks: trackList.length,
  };
}
