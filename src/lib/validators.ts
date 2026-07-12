import { z } from "zod";
import type { Platform } from "./types";

export const PLATFORMS: Platform[] = ["spotify", "apple_music", "youtube_music", "tidal", "deezer"];

/** Recognized music platform hostnames for URL validation */
const PLATFORM_HOSTS = [
  "open.spotify.com", "spotify.com",
  "music.apple.com", "apple.co",
  "music.youtube.com", "youtube.com",
  "tidal.com", "listen.tidal.com",
  "deezer.com", "www.deezer.com",
] as const;

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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AddPlaylistInput = z.infer<typeof addPlaylistSchema>;
export type SyncPlaylistInput = z.infer<typeof syncPlaylistSchema>;
