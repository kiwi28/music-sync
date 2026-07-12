// YouTube Music playlist download handler.
// Uses yt-dlp to:
//   1. Fetch playlist metadata (via `yt-dlp --flat-playlist --dump-json`)
//   2. Deduplicate against existing tracks in PocketBase
//   3. Download as MP3 (via `yt-dlp -x --audio-format mp3`)
//   4. Extract metadata from downloaded files with ffprobe
//   5. Create Track + PlaylistTrack records in PocketBase

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { getAdminClient } from "../pb-client.js";
import { findExistingTrack } from "../dedup.js";
import { parseFileMetadata } from "../metadata.js";
import { ensureDir, sanitizeFolderName } from "../utils.js";

const execFileAsync = promisify(execFile);
const MUSIC_DIR = process.env.MUSIC_DIR || "/music";

/**
 * Process a YouTube Music playlist sync job.
 */
export async function processYoutubeMusicJob(playlist) {
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
        "-o", join(outputDir, "%(playlist_index)02d - %(title)s.%(ext)s"),
        url,
      ], { timeout: 1_800_000 });
    } catch (err) {
      throw new Error(`yt-dlp download failed: ${err.message}`);
    }
  }

  // Phase 4: Create Track + PlaylistTrack records
  let tracksAdded = 0;

  // Link existing tracks
  for (const { trackId, position } of existingTrackIds) {
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
      fileMeta = await parseFileMetadata(join(outputDir, fileMatch));
    }

    // Create track record
    const track = await pb.collection("tracks").create({
      title: fileMeta.title,
      artist: fileMeta.artist,
      album: fileMeta.album || null,
      platform: "youtube_music",
      platform_id: meta._videoId,
      duration_ms: fileMeta.durationMs || meta._durationMs,
      isrc: fileMeta.isrc || null,
    });

    // Create playlist_track relation
    await pb.collection("playlist_tracks").create({
      playlist: playlistId,
      track: track.id,
      position: meta._index,
      added_at: new Date().toISOString(),
    });

    tracksAdded++;
  }

  return {
    tracksAdded,
    totalTracks: trackList.length,
  };
}
