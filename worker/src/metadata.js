// Audio file metadata extraction via ffprobe.
// Used by the download handlers to read rich tags (title, artist, album, ISRC)
// from downloaded MP3 files, falling back to what spotdl/yt-dlp reported.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Parse metadata from an audio file using ffprobe.
 * fallback is used for any field ffprobe cannot extract.
 *
 * @param {string} filePath - Absolute path to the audio file
 * @param {object} [fallback] - Defaults for fields ffprobe cannot read
 * @param {string} [fallback.title]
 * @param {string} [fallback.artist]
 * @param {string} [fallback.album]
 * @param {number} [fallback.durationMs]
 * @param {string} [fallback.isrc]
 * @returns {Promise<{ title: string, artist: string, album: string | null, durationMs: number, isrc: string | null }>}
 */
export async function parseFileMetadata(filePath, fallback = {}) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      filePath,
    ], { timeout: 15_000 });

    const data = JSON.parse(stdout);
    const format = data.format || {};
    const tags = format.tags || {};

    // Prefer ID3 tags; fall back to the stream codec for duration
    const durationSeconds = parseFloat(format.duration) || 0;

    return {
      title: tags.title || fallback.title || "Unknown Title",
      artist: tags.artist || fallback.artist || "Unknown Artist",
      album: tags.album || fallback.album || null,
      durationMs: Math.round(durationSeconds * 1000) || fallback.durationMs || 0,
      isrc: tags.ISRC || tags.isrc || fallback.isrc || null,
    };
  } catch {
    // ffprobe failed — return the fallback values as-is
    return {
      title: fallback.title || "Unknown Title",
      artist: fallback.artist || "Unknown Artist",
      album: fallback.album || null,
      durationMs: fallback.durationMs || 0,
      isrc: fallback.isrc || null,
    };
  }
}
