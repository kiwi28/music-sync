// YouTube Music playlist download handler.
// Uses yt-dlp to:
//   1. Fetch playlist metadata (via `yt-dlp --flat-playlist --dump-json`)
//   2. Deduplicate against existing tracks in PocketBase
//   3. Download each new track individually as MP3 (via `yt-dlp -x --audio-format mp3`)
//   4. Extract metadata from downloaded files with ffprobe
//   5. Create Track + PlaylistTrack records in PocketBase
//
// Tracks are downloaded individually (not in bulk) so that:
//   - Partial progress is preserved if the worker crashes mid-playlist
//   - A single failed track doesn't lose all prior downloads
//   - On retry, already-downloaded tracks are skipped (dedup phase catches them)
//   - Live progress ("X of 325") is visible in the frontend

import { execFile } from "node:child_process";
import { readdir, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { promisify } from "node:util";

import { getAdminClient, withReauth } from "../pb-client.js";
import { findExistingTrack } from "../dedup.js";
import { parseFileMetadata } from "../metadata.js";
import { ensureDir, sanitizeFolderName, generateM3u, sleep } from "../utils.js";

const execFileAsync = promisify(execFile);
const MUSIC_DIR = process.env.MUSIC_DIR || "/music";

/** Timeout per individual track download (5 minutes). */
const TRACK_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Delay between individual track downloads to avoid rate limiting. */
const INTER_TRACK_DELAY_MS = 2000;

/**
 * Result from attempting to download a single track.
 * @typedef {{ ok: true, filePath: string }} OkResult
 * @typedef {{ ok: false, reason: string }} FailResult
 */

/**
 * Download a single track from YouTube Music.
 * Returns { ok: true, filePath } on success, { ok: false, reason } on failure.
 */
async function downloadSingleTrack(videoUrl, outputDir, trackIndex, title) {
  const paddedIndex = String(trackIndex).padStart(2, "0");
  const outputTemplate = join(
    outputDir,
    `${paddedIndex} - %(title)s.%(ext)s`,
  );

  // Check if file already exists (resume after crash)
  try {
    const existing = await readdir(outputDir);
    const match = existing.find(
      (f) => f.startsWith(`${paddedIndex} - `) && f.endsWith(".mp3"),
    );
    if (match) {
      console.log(`[yt-dlp] Track ${trackIndex} already on disk: ${match}`);
      return { ok: true, filePath: join(outputDir, match) };
    }
  } catch {
    // Directory might not exist yet — ensureDir handles it below
  }

  try {
    await execFileAsync(
      "yt-dlp",
      [
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-f", "bestaudio",
        "--embed-metadata",
        "--embed-thumbnail",
        "--no-write-thumbnail",
        "-o", outputTemplate,
        videoUrl,
      ],
      { timeout: TRACK_DOWNLOAD_TIMEOUT_MS },
    );
  } catch (err) {
    const reason = extractDownloadError(err);
    return { ok: false, reason };
  }

  // Find the downloaded file
  try {
    const files = await readdir(outputDir);
    const match = files.find(
      (f) => f.startsWith(`${paddedIndex} - `) && f.endsWith(".mp3"),
    );
    if (match) {
      return { ok: true, filePath: join(outputDir, match) };
    }
    return { ok: false, reason: "Download completed but MP3 file not found" };
  } catch {
    return { ok: false, reason: "Could not read output directory" };
  }
}

/**
 * Extract a human-readable error reason from a yt-dlp exec failure.
 */
function extractDownloadError(err) {
  if (err.killed && err.signal) {
    return `Killed by signal ${err.signal} (likely timeout or OOM)`;
  }
  const msg = err.stderr || err.message || String(err);

  // Map known yt-dlp errors to shorter messages
  if (msg.includes("HTTP Error 429")) return "HTTP 429 — rate limited";
  if (msg.includes("HTTP Error 403")) return "HTTP 403 — forbidden (geo-blocked?)";
  if (msg.includes("HTTP Error 404")) return "HTTP 404 — video not found (deleted?)";
  if (msg.includes("Video unavailable")) return "Video unavailable";
  if (msg.includes("This video is not available")) return "Video not available";
  if (msg.includes("Private video")) return "Private video";
  if (msg.includes("Sign in to confirm your age")) return "Age-restricted (requires login)";
  if (msg.includes("ETIMEDOUT") || msg.includes("ESOCKETTIMEDOUT")) return "Network timeout";
  if (msg.includes("Requested format is not available")) return "Audio format not available";

  // Truncate long error messages
  const short = msg.split("\n")[0].slice(0, 120);
  return short || "Unknown download error";
}

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

  // ── Phase 1: Fetch playlist metadata ──
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

  // ── Phase 2: Dedup against PocketBase ──
  const existingTrackIds = [];
  const newTracks = [];

  for (const meta of trackList) {
    const existing = await findExistingTrack(pb, {
      isrc: null,
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

  console.log(
    `[yt-dlp] ${existingTrackIds.length} existing, ${newTracks.length} new (of ${trackList.length})`,
  );
  onProgress?.(
    `Downloading ${newTracks.length} new tracks (${existingTrackIds.length} already synced)…`,
  );

  // ── Phase 3: Download each new track individually ──
  let tracksAdded = 0;
  const failedTracks = []; // { index, title, reason }

  for (let i = 0; i < newTracks.length; i++) {
    const meta = newTracks[i];
    const trackNum = i + 1;
    const totalNew = newTracks.length;

    // Live progress visible in frontend
    onProgress?.(
      `[${trackNum}/${totalNew}] ${meta._title.slice(0, 70)}`,
    );

    const result = await downloadSingleTrack(
      meta._url,
      outputDir,
      meta._index,
      meta._title,
    );

    if (!result.ok) {
      failedTracks.push({
        index: meta._index,
        title: meta._title,
        reason: result.reason,
      });
      console.warn(
        `[yt-dlp] FAILED #${meta._index} "${meta._title}": ${result.reason}`,
      );
      continue;
    }

    // Parse metadata from the downloaded file
    const fileMeta = await parseFileMetadata(result.filePath, {
      title: meta._title,
      artist: meta._artist,
      album: meta._album,
      durationMs: meta._durationMs,
      isrc: null,
    });

    // Create track + playlist_track records
    try {
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
    } catch (err) {
      failedTracks.push({
        index: meta._index,
        title: meta._title,
        reason: `PB error: ${err.message.slice(0, 100)}`,
      });
      console.error(
        `[yt-dlp] PB error #${meta._index} "${meta._title}": ${err.message}`,
      );
    }

    // Small delay between tracks to avoid hammering YouTube
    if (i < newTracks.length - 1) {
      await sleep(INTER_TRACK_DELAY_MS);
    }
  }

  // ── Phase 4: Link existing tracks (already synced in previous runs) ──
  if (existingTrackIds.length > 0) {
    onProgress?.(`Linking ${existingTrackIds.length} existing tracks…`);
    for (const { trackId, position } of existingTrackIds) {
      await withReauth(async () => {
        const existingLink = await pb
          .collection("playlist_tracks")
          .getList(1, 1, {
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
  }

  // ── Cleanup & finalize ──
  try {
    const allFiles = await readdir(outputDir);
    for (const file of allFiles) {
      const ext = extname(file).toLowerCase();
      if ([".webm", ".webp", ".jpg", ".jpeg", ".png"].includes(ext)) {
        await unlink(join(outputDir, file));
      }
    }
  } catch {
    // Non-critical
  }

  await generateM3u(outputDir, playlist.name);

  // ── Build final summary ──
  const totalSynced = tracksAdded + existingTrackIds.length;
  const summaryLines = [
    `Sync complete: ${tracksAdded} new + ${existingTrackIds.length} existing = ${totalSynced} total tracks`,
  ];

  if (failedTracks.length > 0) {
    summaryLines.push(`${failedTracks.length} tracks failed to download:`);
    for (const ft of failedTracks) {
      summaryLines.push(`  #${ft.index} ${ft.title.slice(0, 60)} — ${ft.reason}`);
    }
  }

  const summary = summaryLines.join("\n");
  console.log(`[yt-dlp] ${summary.replace(/\n/g, " | ")}`);
  onProgress?.(summary);

  return {
    tracksAdded,
    totalTracks: trackList.length,
  };
}
