// Spotify playlist download handler.
// Uses Spotify Web API for metadata (via OAuth tokens in PocketBase)
// and per-track yt-dlp downloads for audio from YouTube.
//
// Flow (API path — when Spotify OAuth works):
//   1. Get Spotify access token from PocketBase (user_connections)
//   2. Fetch track metadata via Spotify Web API
//   3. Deduplicate against existing tracks in PocketBase
//   4. Download each NEW track individually via yt-dlp search
//   5. Create Track + PlaylistTrack records in PocketBase
//
// Flow (fallback — when Spotify API is unavailable):
//   1. Bulk download via spotdl (which handles auth + matching internally)
//   2. Scan downloaded files for metadata
//   3. Create Track + PlaylistTrack records with post-hoc dedup
//
// Per-track downloads (API path) give live "[X of Y]" progress in the
// frontend, matching the YouTube Music sync experience.

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join, extname } from "node:path";

import { getAdminClient, withReauth } from "../pb-client.js";
import { findExistingTrack } from "../dedup.js";
import { parseFileMetadata } from "../metadata.js";
import { ensureDir, sanitizeFolderName, generateM3u, sleep } from "../utils.js";
import { ensureSpotifyToken } from "../spotify-token.js";

const MUSIC_DIR = process.env.MUSIC_DIR || "/music";
const YOUTUBE_COOKIES = process.env.YOUTUBE_COOKIES || null;
const SPOTIFY_API = "https://api.spotify.com/v1";

/** Timeout per individual track download (5 minutes). */
const TRACK_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Delay between individual track downloads to avoid rate limiting. */
const INTER_TRACK_DELAY_MS = 2000;

/** Timeout for bulk spotdl download (30 minutes). */
const SPOTDL_BULK_TIMEOUT_MS = 1_800_000;

// ── Spotify API helpers ──

/**
 * Fetch all tracks from a Spotify playlist via the Web API.
 * Handles pagination (max 100 tracks per request).
 * Throws on auth/permission errors so the caller can fall back.
 */
async function fetchPlaylistTracks(accessToken, playlistId, onProgress) {
  const tracks = [];
  // Use /items (not /tracks) — Spotify deprecated /tracks in newer API versions
  // and returns 403 for it, even with valid OAuth scopes.
  let url = `${SPOTIFY_API}/playlists/${playlistId}/items?limit=100`;

  while (url) {
    onProgress?.(`Fetching tracks from Spotify (${tracks.length} so far)…`);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const err = await response.text();
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        console.error(`[spotdl] Spotify API ${response.status} for playlist ${playlistId}: ${err}`);
        throw new Error(
          `Cannot access this Spotify playlist (HTTP ${response.status}). ` +
          "It may be private or require authentication. " +
          "Go to Settings → Connect Spotify to link your account."
        );
      }
      throw new Error(`Spotify API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    for (const item of data.items) {
      // /items endpoint wraps the track in `item.item` (with `item.item.track: true`).
      // /tracks endpoint (deprecated) used `item.track` directly.
      // We support both formats for backward compat.
      const track = item.track && item.track.type === "track"
        ? item.track
        : item.item?.type === "track"
          ? item.item
          : null;
      if (track) {
        tracks.push(track);
      }
    }
    url = data.next;
  }

  return tracks;
}

// ── Per-track download (API path) ──

/**
 * Download a single track by searching YouTube.
 * Uses yt-dlp with a search query, matching spotdl's internal approach.
 * Returns { ok: true, filePath } on success, { ok: false, reason } on failure.
 */
function downloadSingleTrack(artist, title, outputDir, paddedIndex) {
  return new Promise((resolve) => {
    const outputTemplate = join(
      outputDir,
      `${paddedIndex} - %(title)s.%(ext)s`,
    );
    const searchQuery = `ytsearch1:${artist} - ${title}`;

    const proc = spawn("yt-dlp", [
      "-x",
      "--audio-format", "mp3",
      "--audio-quality", "0",
      "-f", "bestaudio",
      "--embed-metadata",
      "--embed-thumbnail",
      "--no-write-thumbnail",
      "-o", outputTemplate,
      ...(YOUTUBE_COOKIES ? ["--cookies", YOUTUBE_COOKIES] : []),
      searchQuery,
    ], {
      timeout: TRACK_DOWNLOAD_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", async (code) => {
      if (code !== 0) {
        const reason = extractDownloadError(stderr);
        resolve({ ok: false, reason });
        return;
      }

      // Find the downloaded file
      try {
        const files = await readdir(outputDir);
        const match = files.find(
          (f) => f.startsWith(`${paddedIndex} - `) && f.endsWith(".mp3"),
        );
        if (match) {
          resolve({ ok: true, filePath: join(outputDir, match) });
        } else {
          resolve({ ok: false, reason: "Download completed but MP3 file not found" });
        }
      } catch {
        resolve({ ok: false, reason: "Could not read output directory" });
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, reason: `Process error: ${err.message}` });
    });
  });
}

/**
 * Extract a human-readable error reason from a yt-dlp exec failure.
 */
function extractDownloadError(stderr) {
  const msg = stderr || "";

  if (msg.includes("HTTP Error 429")) return "HTTP 429 — rate limited";
  if (msg.includes("HTTP Error 403")) return "HTTP 403 — forbidden (geo-blocked?)";
  if (msg.includes("HTTP Error 404")) return "HTTP 404 — video not found";
  if (msg.includes("Video unavailable")) return "Video unavailable";
  if (msg.includes("Private video")) return "Private video";
  if (msg.includes("Sign in to confirm your age")) return "Age-restricted (requires login)";
  if (msg.includes("ETIMEDOUT") || msg.includes("ESOCKETTIMEDOUT")) return "Network timeout";

  const short = msg.split("\n").find(l => l.includes("ERROR") || l.includes("WARNING")) || msg.split("\n")[0];
  return short?.slice(0, 120) || "Unknown download error";
}

// ── Bulk download (fallback path) ──

/**
 * Run spotdl as a bulk download, streaming its stdout/stderr to the
 * console so progress is visible in Docker logs.
 * Resolves when spotdl exits, rejects on non-zero exit.
 */
function runSpotdlBulk(args) {
  return new Promise((resolve, reject) => {
    console.log(`[spotdl] Bulk download: spotdl ${args.join(" ")}`);
    const proc = spawn("spotdl", args, {
      timeout: SPOTDL_BULK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (line.trim()) console.log(`[spotdl] ${line.trim()}`);
      }
    });

    proc.stderr.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (line.trim()) console.warn(`[spotdl:err] ${line.trim()}`);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`spotdl exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`spotdl process error: ${err.message}`));
    });
  });
}

// ── Main job processor ──

/**
 * Process a Spotify playlist sync job.
 */
export async function processSpotifyJob(playlist, onProgress) {
  const pb = await getAdminClient();
  const playlistId = playlist.id;
  const url = playlist.url;

  // Get a valid Spotify access token from PocketBase
  let accessToken;
  try {
    accessToken = await ensureSpotifyToken(pb, playlist.user);
  } catch (err) {
    throw new Error(`Spotify auth: ${err.message}`);
  }

  const outputDir = join(
    MUSIC_DIR,
    "spotify",
    sanitizeFolderName(playlist.name),
  );
  await ensureDir(outputDir);

  const platformId = playlist.platform_id;
  if (!platformId) {
    throw new Error("Playlist has no platform_id — cannot fetch from Spotify API");
  }

  // ── Phase 1: Try Spotify API for track metadata ──
  onProgress?.(`Fetching track list from Spotify…`);
  console.log(`[spotdl] Fetching tracks for "${playlist.name}" via Spotify API…`);

  let trackList = [];
  let spotifyApiFailed = false;
  try {
    trackList = await fetchPlaylistTracks(accessToken, platformId, onProgress);
  } catch (err) {
    console.warn(`[spotdl] Spotify API unavailable: ${err.message}`);
    console.warn(`[spotdl] Falling back to bulk spotdl download (no per-track progress)`);
    spotifyApiFailed = true;
  }

  if (!spotifyApiFailed && !trackList.length) {
    throw new Error("Spotify returned empty track list — playlist may be empty or private");
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATH A: API worked — per-track download with [X/Y] progress
  // ═══════════════════════════════════════════════════════════════════
  if (!spotifyApiFailed && trackList.length > 0) {
    console.log(`[spotdl] Got metadata for ${trackList.length} tracks`);
    onProgress?.(`Found ${trackList.length} tracks, checking for new ones…`);

    // Dedup against PocketBase
    const existingTrackIds = [];
    const newTracks = [];

    for (const meta of trackList) {
      const isrc = meta.external_ids?.isrc || null;
      const tid = meta.id || null;
      const title = meta.name || "Unknown Title";
      const artist = meta.artists?.[0]?.name
        || meta.artists?.map((a) => a.name).join(", ")
        || "Unknown Artist";

      const existing = await findExistingTrack(pb, {
        isrc,
        title,
        artist,
        platform: "spotify",
        platformId: tid,
      });

      if (existing) {
        existingTrackIds.push({
          trackId: existing.id,
          position: trackList.indexOf(meta) + 1,
        });
      } else {
        newTracks.push({
          _title: title,
          _artist: artist,
          _isrc: isrc,
          _platformId: tid,
          _album: meta.album?.name || null,
          _durationMs: meta.duration_ms || 0,
          _coverUrl: meta.album?.images?.[0]?.url || null,
        });
      }
    }

    console.log(`[spotdl] ${existingTrackIds.length} existing, ${newTracks.length} new (of ${trackList.length})`);

    // Link existing tracks that aren't already linked
    if (existingTrackIds.length > 0) {
      onProgress?.(`Linking ${existingTrackIds.length} existing tracks…`);
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
    }

    // Per-track download with live [X/Y] progress
    let tracksAdded = 0;
    const failedTracks = [];

    if (newTracks.length > 0) {
      for (let i = 0; i < newTracks.length; i++) {
        const meta = newTracks[i];
        const trackNum = i + 1;
        const totalNew = newTracks.length;
        const paddedIndex = String(trackList.indexOf(
          trackList.find((t) => t.id === meta._platformId)
        ) + 1).padStart(2, "0");

        // Live progress: "[12/45] Artist - Title"
        const progressLabel = `[${trackNum}/${totalNew}] ${meta._artist?.slice(0, 25)} - ${meta._title?.slice(0, 50)}`;
        onProgress?.(progressLabel);
        console.log(`[spotdl] ${progressLabel}`);

        // Check if file already exists (resume after crash)
        let alreadyOnDisk = false;
        try {
          const existing = await readdir(outputDir);
          const match = existing.find(
            (f) => f.startsWith(`${paddedIndex} - `) && f.endsWith(".mp3"),
          );
          if (match) {
            console.log(`[spotdl] Track ${trackNum} already on disk: ${match}`);
            alreadyOnDisk = true;

            // Parse metadata from existing file
            const fileMeta = await parseFileMetadata(join(outputDir, match), {
              title: meta._title,
              artist: meta._artist,
              album: meta._album,
              durationMs: meta._durationMs,
              isrc: meta._isrc,
            });

            try {
              await withReauth(async () => {
                const track = await pb.collection("tracks").create({
                  title: fileMeta.title,
                  artist: fileMeta.artist,
                  album: meta._album || fileMeta.album || null,
                  platform: "spotify",
                  platform_id: meta._platformId || "",
                  duration_ms: fileMeta.durationMs || meta._durationMs,
                  isrc: fileMeta.isrc || null,
                  cover_url: meta._coverUrl,
                });
                await pb.collection("playlist_tracks").create({
                  playlist: playlistId,
                  track: track.id,
                  position: trackList.indexOf(
                    trackList.find((t) => t.id === meta._platformId)
                  ) + 1,
                  added_at: new Date().toISOString(),
                });
              });
              tracksAdded++;
            } catch (err) {
              console.warn(`[spotdl] PB error for existing file ${meta._title}: ${err.message}`);
            }
            continue;
          }
        } catch {
          // Directory might not exist yet
        }

        if (alreadyOnDisk) continue;

        // Download the track
        const result = await downloadSingleTrack(
          meta._artist,
          meta._title,
          outputDir,
          paddedIndex,
        );

        if (!result.ok) {
          failedTracks.push({
            index: trackList.indexOf(
              trackList.find((t) => t.id === meta._platformId)
            ) + 1,
            title: meta._title,
            reason: result.reason,
          });
          console.warn(`[spotdl] FAILED #${paddedIndex} "${meta._title}": ${result.reason}`);
          continue;
        }

        // Parse metadata from the downloaded file
        const fileMeta = await parseFileMetadata(result.filePath, {
          title: meta._title,
          artist: meta._artist,
          album: meta._album,
          durationMs: meta._durationMs,
          isrc: meta._isrc,
        });

        // Create track + playlist_track records
        try {
          await withReauth(async () => {
            const track = await pb.collection("tracks").create({
              title: fileMeta.title,
              artist: fileMeta.artist,
              album: meta._album || fileMeta.album || null,
              platform: "spotify",
              platform_id: meta._platformId || "",
              duration_ms: fileMeta.durationMs || meta._durationMs,
              isrc: fileMeta.isrc || null,
              cover_url: meta._coverUrl,
            });

            await pb.collection("playlist_tracks").create({
              playlist: playlistId,
              track: track.id,
              position: trackList.indexOf(
                trackList.find((t) => t.id === meta._platformId)
              ) + 1,
              added_at: new Date().toISOString(),
            });
          });

          tracksAdded++;
        } catch (err) {
          failedTracks.push({
            index: trackList.indexOf(
              trackList.find((t) => t.id === meta._platformId)
            ) + 1,
            title: meta._title,
            reason: `PB error: ${err.message.slice(0, 100)}`,
          });
          console.error(`[spotdl] PB error "${meta._title}": ${err.message}`);
        }

        // Small delay between tracks to avoid rate limiting
        if (i < newTracks.length - 1) {
          await sleep(INTER_TRACK_DELAY_MS);
        }
      }
    }

    // ── Cleanup & finalize ──
    await generateM3u(outputDir, playlist.name);

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
    console.log(`[spotdl] ${summary.replace(/\n/g, " | ")}`);
    onProgress?.(summary);

    return {
      tracksAdded,
      totalTracks: totalSynced,
      failedTracks,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PATH B: API unavailable — bulk spotdl download + scan files
  // ═══════════════════════════════════════════════════════════════════
  onProgress?.(`Downloading playlist via spotdl (API unavailable, no per-track progress)…`);
  console.log(`[spotdl] Downloading entire playlist (API unavailable, no pre-filtering)...`);

  const spotdlArgs = [
    "download", url,
    "--output", join(outputDir, "{artist} - {title}.{output-ext}"),
    "--format", "mp3",
    "--bitrate", "320k",
  ];

  // Pass YouTube cookies for age-restricted tracks in bulk mode
  if (YOUTUBE_COOKIES) {
    spotdlArgs.push("--cookie-file", YOUTUBE_COOKIES);
  }

  try {
    await runSpotdlBulk(spotdlArgs);
  } catch (err) {
    throw new Error(`spotdl download failed: ${err.message}`);
  }

  // Scan downloaded files and create records with dedup
  onProgress?.(`Scanning downloaded files…`);
  let tracksAdded = 0;
  let totalFiles = 0;

  try {
    const files = await readdir(outputDir);
    const audioFiles = files.filter((f) => {
      const ext = f.toLowerCase();
      return ext.endsWith(".mp3") || ext.endsWith(".flac") || ext.endsWith(".m4a") || ext.endsWith(".ogg");
    });
    totalFiles = audioFiles.length;

    for (let i = 0; i < audioFiles.length; i++) {
      const file = audioFiles[i];
      const filePath = join(outputDir, file);
      onProgress?.(`[${i + 1}/${totalFiles}] Processing ${file.slice(0, 60)}…`);

      let fileMeta;
      try {
        fileMeta = await parseFileMetadata(filePath, {
          title: file,
          artist: "Unknown Artist",
          album: null,
          durationMs: 0,
          isrc: null,
        });
      } catch {
        console.warn(`[spotdl] Could not parse metadata for ${file}, skipping`);
        continue;
      }

      // Dedup by title + artist
      const existing = await findExistingTrack(pb, {
        isrc: fileMeta.isrc || null,
        title: fileMeta.title,
        artist: fileMeta.artist,
        platform: "spotify",
        platformId: null,
      });

      if (existing) {
        await withReauth(async () => {
          const existingLink = await pb.collection("playlist_tracks").getList(1, 1, {
            filter: `playlist = "${playlistId}" && track = "${existing.id}"`,
          });
          if (existingLink.totalItems === 0) {
            await pb.collection("playlist_tracks").create({
              playlist: playlistId,
              track: existing.id,
              position: i + 1,
              added_at: new Date().toISOString(),
            });
          }
        });
        continue;
      }

      try {
        await withReauth(async () => {
          const track = await pb.collection("tracks").create({
            title: fileMeta.title,
            artist: fileMeta.artist,
            album: fileMeta.album || null,
            platform: "spotify",
            platform_id: fileMeta.isrc || "",
            duration_ms: fileMeta.durationMs || 0,
            isrc: fileMeta.isrc || null,
          });

          await pb.collection("playlist_tracks").create({
            playlist: playlistId,
            track: track.id,
            position: i + 1,
            added_at: new Date().toISOString(),
          });

          tracksAdded++;
        });
      } catch (err) {
        console.warn(`[spotdl] Failed to create record for ${fileMeta.title}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[spotdl] File scanning error: ${err.message}`);
  }

  await generateM3u(outputDir, playlist.name);

  console.log(`[spotdl] Fallback sync complete: ${tracksAdded} new tracks from ${totalFiles} files`);
  return {
    tracksAdded,
    totalTracks: totalFiles,
    failedTracks: [], // fallback path doesn't track per-track failures
  };
}
