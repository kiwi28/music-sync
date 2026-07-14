// Utility helpers for the worker.

import { mkdir } from "node:fs/promises";

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
 */
export async function ensureDir(dirPath) {
  return mkdir(dirPath, { recursive: true });
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
