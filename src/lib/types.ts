// ── Music Sync Type Definitions ──
// Maps to PocketBase collections; kept in sync with pb_data schema

export type Platform = "spotify" | "apple_music" | "youtube_music" | "tidal" | "deezer";

export type SyncStatus = "pending" | "running" | "completed" | "failed";

export interface UserConnection {
  id: string;
  user: string;
  platform: Platform;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  platform_user_id: string;
  platform_username: string;
}

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
  platform: Platform;
  platform_id: string;
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

/** Spotify-specific types */
export interface SpotifyTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  public: boolean;
  tracks: { total: number };
  images: { url: string; height: number; width: number }[];
}

export interface SpotifyTrack {
  id: string;
  name: string;
  type: string;
  duration_ms: number;
  external_ids: { isrc?: string };
  album: {
    name: string;
    images: { url: string; height: number; width: number }[];
  };
  artists: { name: string }[];
  uri: string;
}

/** Dashboard stats */
export interface DashboardStats {
  totalPlaylists: number;
  totalTracks: number;
  connectedPlatforms: Platform[];
  recentSyncs: SyncJob[];
}
