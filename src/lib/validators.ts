import { z } from "zod";
import type { Platform } from "./types";

export const PLATFORMS: Platform[] = ["spotify", "apple_music", "youtube_music", "tidal", "deezer"];

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

/** Sync trigger schema */
export const syncPlaylistSchema = z.object({
  playlistId: z.string().min(1),
  direction: z.enum(["import", "export"]).default("import"),
  platform: z.enum(["spotify", "apple_music", "youtube_music", "tidal", "deezer"]),
});

/** Create playlist schema */
export const createPlaylistSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(false),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SyncPlaylistInput = z.infer<typeof syncPlaylistSchema>;
export type CreatePlaylistInput = z.infer<typeof createPlaylistSchema>;
