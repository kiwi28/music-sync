// Spotify playlist download handler.
// Uses Spotify Web API for metadata (via OAuth tokens in PocketBase)
// and spotdl for downloading audio from YouTube.
//
// Flow:
//   1. Get Spotify access token from PocketBase (user_connections)
//   2. Fetch track metadata via Spotify Web API
//   3. Deduplicate against existing tracks in PocketBase
//   4. Download new tracks via spotdl (no auth needed for YT downloads)
//   5. Create Track + PlaylistTrack records in PocketBase

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { getAdminClient, withReauth } from "../pb-client.js";
import { findExistingTrack } from "../dedup.js";
import { parseFileMetadata } from "../metadata.js";
import { ensureDir, sanitizeFolderName } from "../utils.js";
import { ensureSpotifyToken } from "../spotify-token.js";

const execFileAsync = promisify(execFile);
const MUSIC_DIR = process.env.MUSIC_DIR || "/music";
const SPOTIFY_API = "https://api.spotify.com/v1";

/**
 * Fetch all tracks from a Spotify playlist via the Web API.
 * Handles pagination (max 100 tracks per request).
 */
async function fetchPlaylistTracks(accessToken, playlistId, onProgress) {
  const tracks = [];
  let url = `${SPOTIFY_API}/playlists/${playlistId}/tracks?limit=100`;

  while (url) {
    onProgress?.(`Fetching tracks from Spotify (${tracks.length} so far)…`);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const err = await response.text();
      // Private playlist / needs auth
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new Error(
          "Cannot access this Spotify playlist. It may be private or require authentication. " +
          "Go to Settings → Connect Spotify to link your account."
        );
      }
      throw new Error(`Spotify API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    for (const item of data.items) {
      if (item.track) {
        tracks.push(item.track);
      }
    }
    url = data.next;
  }

  return tracks;
}

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
    accessToken = await ensureSpotifyToken(pb);
  } catch (err) {
    throw new Error(`Spotify auth: ${err.message}`);
  }

  const outputDir = join(
    MUSIC_DIR,
    "spotify",
    sanitizeFolderName(playlist.name),
  );
  await ensureDir(outputDir);

  // Phase 1: Fetch track metadata via Spotify Web API
  onProgress?.(`Fetching track list from Spotify…`);
  console.log(`[spotdl] Fetching tracks for "${playlist.name}" via Spotify API…`);

  // Extract playlist ID from URL
  const platformId = playlist.platform_id;
  if (!platformId) {
    throw new Error("Playlist has no platform_id — cannot fetch from Spotify API");
  }

  const trackList = await fetchPlaylistTracks(accessToken, platformId, onProgress);

  if (!trackList.length) {
    throw new Error("Spotify returned empty track list — playlist may be empty or private");
  }

  console.log(`[spotdl] Got metadata for ${trackList.length} tracks`);
  onProgress?.(`Found ${trackList.length} tracks, checking for new ones…`);

  // Phase 2: Dedup against PocketBase
  const existingTrackIds = [];
  const newTracks = [];

  for (const meta of trackList) {
    const isrc = meta.external_ids?.isrc || null;
    const platformId = meta.id || null;
    const title = meta.name || "Unknown Title";
    const artist = meta.artists?.[0]?.name
      || meta.artists?.map((a) => a.name).join(", ")
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
        _title: title,
        _artist: artist,
        _isrc: isrc,
        _platformId: platformId,
        _album: meta.album?.name || null,
        _durationMs: meta.duration_ms || 0,
        _coverUrl: meta.album?.images?.[0]?.url || null,
      });
    }
  }

  console.log(`[spotdl] ${existingTrackIds.length} existing, ${newTracks.length} new (of ${trackList.length})`);
  onProgress?.(`Downloading ${newTracks.length} new tracks (${existingTrackIds.length} already synced)…`);

  // Phase 3: Download new tracks via spotdl (from YouTube, no Spotify auth needed)
  if (newTracks.length > 0) {
    console.log(`[spotdl] Downloading ${newTracks.length} new tracks...`);
    try {
      await execFileAsync("spotdl", [
        "download", url,
        "--output", join(outputDir, "{artist} - {title}.{output-ext}"),
        "--format", "mp3",
        "--bitrate", "320k",
      ], { timeout: 1_800_000 });
    } catch (err) {
      throw new Error(`spotdl download failed: ${err.message}`);
    }
  }

  // Phase 4: Create Track + PlaylistTrack records
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
    let fileMeta = {
      title: meta._title,
      artist: meta._artist,
      album: meta._album,
      durationMs: meta._durationMs,
      isrc: meta._isrc,
    };

    // Try to read metadata from the downloaded file for richer tags
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
          album: meta._album,
          durationMs: meta._durationMs,
          isrc: meta._isrc,
        });
      }
    } catch {
      // Fall back to Spotify metadata (already set in fileMeta defaults)
    }

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
