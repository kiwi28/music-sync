// Utility helpers for the worker.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Sleep for `ms` milliseconds. */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Escape a string for safe use inside a PocketBase filter literal.
 * Backslash-escapes backslashes, double quotes, and single quotes.
 * Caps the value at 500 characters to prevent query bloat.
 */
export function escapeFilter(value) {
  const capped = String(value).slice(0, 500);
  return capped
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

/**
 * Create a directory (and all intermediate directories) if it doesn't exist.
 * No-op if the directory already exists.
 * Uses mode 0o777 so directories are writable by the Next.js app container
 * (which runs as a different uid on the shared /music volume).
 */
export async function ensureDir(dirPath) {
  return mkdir(dirPath, { recursive: true, mode: 0o777 });
}

/**
 * Sanitize a string for use as a filesystem folder name.
 * Replaces path separators and other unsafe characters.
 */
export function sanitizeFolderName(name) {
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/**
 * Extract an error message from any thrown value, truncating to a safe length.
 */
export function extractErrorMessage(err, maxLen = 500) {
  const msg =
    err instanceof Error ? err.message : String(err || "Unknown error");
  return msg.length > maxLen ? msg.slice(0, maxLen) + "…" : msg;
}

/**
 * Generate an .m3u playlist file listing all audio files in a directory.
 * Useful for Navidrome and other players to import the synced tracks as a
 * local playlist. Non-fatal — errors are logged but do not fail the sync.
 */
export async function generateM3u(dirPath, playlistName) {
  const safeName = sanitizeFolderName(playlistName);
  const m3uPath = join(dirPath, `${safeName}.m3u`);
  const AUDIO_EXTS = new Set([
    ".mp3", ".flac", ".m4a", ".ogg", ".wav", ".opus", ".m4b", ".aac",
  ]);

  try {
    const files = await readdir(dirPath);
    const audioFiles = files
      .filter((f) => {
        const dot = f.lastIndexOf(".");
        if (dot === -1) return false;
        return AUDIO_EXTS.has(f.slice(dot).toLowerCase());
      })
      .sort();

    // .m3u is just a newline-separated list of relative filenames
    const NL = "\n";
    const m3uContent = audioFiles.join(NL) + (audioFiles.length ? NL : "");
    // mode 0o666 so the Next.js app container can overwrite this file later
    await writeFile(m3uPath, m3uContent, { encoding: "utf-8", mode: 0o666 });
    console.log(
      `[m3u] Generated "${playlistName}.m3u" (${audioFiles.length} tracks)`,
    );
  } catch (err) {
    console.error(
      `[m3u] Failed to generate .m3u for "${playlistName}":`,
      err.message,
    );
  }
}
