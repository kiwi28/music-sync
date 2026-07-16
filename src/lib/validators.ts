import { z } from "zod";
import type { Platform } from "./types";
import { PLATFORM_DOMAINS } from "./url-utils";

export const PLATFORMS: Platform[] = ["spotify", "apple_music", "youtube_music", "tidal", "deezer"];

/** Recognized music platform hostnames for URL validation — derived from canonical source */
const PLATFORM_HOSTS = Object.keys(PLATFORM_DOMAINS) as readonly string[];

/** User registration schema */
export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  passwordConfirm: z.string(),
}).refine((data) => data.password === data.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"],
});

/** User login schema */
export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

/** Add playlist from public URL */
export const addPlaylistSchema = z.object({
  url: z
    .string()
    .min(1, "URL is required")
    .url("Must be a valid URL")
    .refine(
      (url) => {
        try {
          const host = new URL(url).hostname.replace(/^www\./, "");
          return PLATFORM_HOSTS.some((h) => host === h);
        } catch {
          return false;
        }
      },
      { message: "URL must be from a supported music platform (Spotify, Apple Music, YouTube Music, Tidal, or Deezer)" },
    ),
  name: z.string().max(200).optional(),
});

/** Sync trigger schema — simplified: no platform or direction needed */
export const syncPlaylistSchema = z.object({
  playlistId: z.string().min(1),
});

/** File browser: browse directory */
export const browseFilesSchema = z.object({
  path: z.string().optional().default("/"),
});

/** File browser: create folder */
export const createFolderSchema = z.object({
  path: z.string().min(1, "Parent path is required"),
  name: z.string().min(1, "Folder name is required").max(200),
});

/** File browser: delete file/folder */
export const deleteFileSchema = z.object({
  path: z.string().min(1, "Path is required"),
});

/** File browser: move/rename */
export const moveFileSchema = z.object({
  from: z.string().min(1, "Source path is required"),
  to: z.string().min(1, "Destination path is required"),
});

/** File browser: M3U refresh */
export const refreshM3uSchema = z.object({
  playlistId: z.string().optional(),
  path: z.string().optional(),
}).refine((d) => d.playlistId || d.path, {
  message: "Either playlistId or path is required",
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AddPlaylistInput = z.infer<typeof addPlaylistSchema>;
export type SyncPlaylistInput = z.infer<typeof syncPlaylistSchema>;
export type BrowseFilesInput = z.infer<typeof browseFilesSchema>;
export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type DeleteFileInput = z.infer<typeof deleteFileSchema>;
export type MoveFileInput = z.infer<typeof moveFileSchema>;
export type RefreshM3uInput = z.infer<typeof refreshM3uSchema>;
