// ── Music Sync Type Definitions ──
// Maps to PocketBase collections; kept in sync with pb_data schema

export type Platform = "spotify" | "apple_music" | "youtube_music" | "tidal" | "deezer";

export type SyncStatus = "pending" | "running" | "completed" | "failed";

export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  platform: Platform;
  platform_id: string;
  duration_ms?: number;
  isrc?: string;
  cover_url?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  /** Public URL pasted by the user (e.g. https://open.spotify.com/playlist/...). May be missing on legacy records imported via old Spotify API integration. */
  url?: string;
  /** Auto-detected from the URL */
  platform: Platform;
  /** Optional — extracted from URL when the platform pattern is known */
  platform_id?: string;
  user: string;
  track_count?: number;
  last_synced?: string;
  cover_url?: string;
  is_public?: boolean;
  /** Populated on expand */
  expand?: {
    playlist_tracks_via_playlist?: PlaylistTrack[];
  };
}

export interface PlaylistTrack {
  id: string;
  playlist: string;
  /** PocketBase relation — string ID when not expanded, Track object when expanded */
  track: string | Track;
  position: number;
  added_at?: string;
  /** Populated on expand */
  expand?: {
    track?: Track;
  };
}

export interface SyncJob {
  id: string;
  created: string;
  updated: string;
  playlist: string;
  user: string;
  status: SyncStatus;
  started_at?: string;
  completed_at?: string;
  tracks_added?: number;
  tracks_removed?: number;
  error?: string;
  log?: string;
  /** Populated on expand */
  expand?: {
    playlist?: Playlist;
  };
}
