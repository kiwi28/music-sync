"server-only";

import { mkdir, readdir, rm, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve, sep, relative, parse } from "node:path";

// ── Constants ──────────────────────────────────────────

/** Root directory for all music files — set via MUSIC_DIR env var. */
export const MUSIC_ROOT = resolve(process.env.MUSIC_DIR || "/music");

/** Audio file extensions recognised by the M3U generator. */
const AUDIO_EXTS = new Set([
  ".mp3", ".flac", ".m4a", ".ogg", ".wav", ".opus", ".m4b", ".aac",
]);

// ── Path Safety ────────────────────────────────────────

/**
 * Validate that `userPath` resolves underneath `MUSIC_ROOT`.
 * Returns the resolved absolute path on success, or `null` if the
 * path would escape the music root (path-traversal attempt).
 */
export function validatePath(userPath: string): string | null {
  // Resolve relative to MUSIC_ROOT so "../" tricks don't escape.
  const resolved = resolve(MUSIC_ROOT, userPath);

  // Normalise separators for reliable prefix check on Windows.
  const normalisedRoot = MUSIC_ROOT.endsWith(sep)
    ? MUSIC_ROOT
    : MUSIC_ROOT + sep;
  const normalisedResolved = resolved.endsWith(sep)
    ? resolved
    : resolved + sep;

  if (!normalisedResolved.startsWith(normalisedRoot)) {
    return null;
  }
  return resolved;
}

/**
 * Sanitize a string for use as a filesystem folder name.
 * Mirrors the worker's `sanitizeFolderName()` in `worker/src/utils.js`.
 */
export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[/\\?%*:|"<>]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

// ── Directory Listing ──────────────────────────────────

export interface FileEntry {
  name: string;
  path: string; // absolute path
  isDirectory: boolean;
  size?: number; // bytes, files only
  ext?: string; // lowercase with dot, e.g. ".mp3"
}

/**
 * List the contents of a directory.
 * Entries are sorted: directories first (alphabetically), then files.
 */
export async function listDirectory(dirPath: string): Promise<FileEntry[]> {
  const safePath = validatePath(dirPath);
  if (!safePath) {
    throw new Error("Path is outside the music directory");
  }

  const names = await readdir(safePath);
  const entries: FileEntry[] = [];

  for (const name of names) {
    // Skip hidden files/folders
    if (name.startsWith(".")) continue;

    const fullPath = join(safePath, name);
    let isDirectory = false;
    let size: number | undefined;
    let ext: string | undefined;

    try {
      const s = await stat(fullPath);
      isDirectory = s.isDirectory();
      if (!isDirectory) {
        size = s.size;
        const dot = name.lastIndexOf(".");
        ext = dot !== -1 ? name.slice(dot).toLowerCase() : undefined;
      }
    } catch {
      // File vanished between readdir and stat — skip
      continue;
    }

    entries.push({ name, path: fullPath, isDirectory, size, ext });
  }

  // Sort: directories first (alpha), then files (alpha)
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return entries;
}

// ── Mutation Operations ────────────────────────────────

/** Create a directory (and all intermediate directories) if it doesn't exist. */
export async function createFolder(dirPath: string): Promise<string> {
  const safePath = validatePath(dirPath);
  if (!safePath) {
    throw new Error("Path is outside the music directory");
  }
  await mkdir(safePath, { recursive: true });
  return safePath;
}

/**
 * Delete a file or folder.
 * Folders are deleted recursively. Refuses to delete the MUSIC_ROOT itself.
 */
export async function deletePath(targetPath: string): Promise<void> {
  const safePath = validatePath(targetPath);
  if (!safePath) {
    throw new Error("Path is outside the music directory");
  }
  if (safePath === MUSIC_ROOT) {
    throw new Error("Cannot delete the root music directory");
  }
  await rm(safePath, { recursive: true, force: true });
}

/**
 * Move / rename a file or folder.
 * `from` and `to` are both validated to be under MUSIC_ROOT.
 */
export async function movePath(from: string, to: string): Promise<void> {
  const safeFrom = validatePath(from);
  const safeTo = validatePath(to);
  if (!safeFrom || !safeTo) {
    throw new Error("Path is outside the music directory");
  }
  // Ensure the destination parent directory exists
  const parent = to.slice(0, to.lastIndexOf(sep));
  if (parent) {
    await mkdir(parent, { recursive: true });
  }
  await rename(safeFrom, safeTo);
}

// ── M3U Generation ─────────────────────────────────────

/**
 * Generate an `.m3u` playlist file listing all audio files in a directory.
 * Mirrors `generateM3u()` in `worker/src/utils.js`.
 *
 * Returns the number of audio tracks written, or -1 on error.
 */
export async function generateM3u(
  dirPath: string,
  playlistName: string,
): Promise<number> {
  const safePath = validatePath(dirPath);
  if (!safePath) {
    throw new Error("Path is outside the music directory");
  }

  const safeName = sanitizeFolderName(playlistName);
  const m3uPath = join(safePath, `${safeName}.m3u`);

  try {
    const entries = await listDirectory(safePath);
    const audioFiles = entries
      .filter((e) => !e.isDirectory && e.ext && AUDIO_EXTS.has(e.ext))
      .map((e) => e.name)
      .sort();

    const NL = "\n";
    const content = audioFiles.join(NL) + (audioFiles.length ? NL : "");
    await writeFile(m3uPath, content, "utf-8");

    return audioFiles.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[m3u] Failed to generate .m3u for "${playlistName}":`, msg);
    return -1;
  }
}

// ── Helpers ────────────────────────────────────────────

/**
 * Build the filesystem path to a playlist directory.
 * `/music/<platform>/<sanitized-name>/`
 */
export function getPlaylistDir(platform: string, playlistName: string): string {
  const safePlatform = sanitizeFolderName(platform);
  const safeName = sanitizeFolderName(playlistName);
  return join(MUSIC_ROOT, safePlatform, safeName);
}

/**
 * Build the filesystem path to a playlist directory from an existing
 * PocketBase playlist record (which has `platform` and `name` fields).
 */
export function getPlaylistDirFromRecord(playlist: {
  platform: string;
  name: string;
}): string {
  return getPlaylistDir(playlist.platform, playlist.name);
}
