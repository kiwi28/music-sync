"use client";

import { useState, useEffect, useCallback } from "react";
import type { Playlist, SyncJob } from "@/lib/types";
import { useAuth } from "@/components/layout/providers";

export function usePlaylists() {
  const { pb, user } = useAuth();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylists = useCallback(async () => {
    if (!user) {
      setPlaylists([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const records = await pb
        .collection("playlists")
        .getFullList<Playlist>({
          filter: `user = "${user.id}"`,
          sort: "-last_synced",
        });
      setPlaylists(records);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlists");
    } finally {
      setLoading(false);
    }
  }, [pb, user]);

  useEffect(() => {
    fetchPlaylists();
  }, [fetchPlaylists]);

  return { playlists, loading, error, refetch: fetchPlaylists };
}

export function usePlaylist(id: string) {
  const { pb, user } = useAuth();
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlaylist = useCallback(async () => {
    if (!user || !id) return;
    try {
      setLoading(true);
      setError(null);
      const record = await pb.collection("playlists").getOne<Playlist>(id, {
        expand: "playlist_tracks_via_playlist.track",
      });
      setPlaylist(record);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    } finally {
      setLoading(false);
    }
  }, [pb, user, id]);

  useEffect(() => {
    fetchPlaylist();
  }, [fetchPlaylist]);

  return { playlist, loading, error, refetch: fetchPlaylist };
}

export function useSyncJobs(limit = 10) {
  const { pb, user } = useAuth();
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setJobs([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      // NOTE: expand=playlist is omitted — PocketBase 0.28.x returns 400
      // "Something went wrong" with expand on sync_jobs. The playlist name
      // is displayed from the cached playlist list instead.
      const records = await pb.collection("sync_jobs").getList<SyncJob>(1, limit, {
        filter: `user = "${user.id}"`,
        sort: "-created",
      });
      setJobs(records.items);
    } catch (err) {
      console.error("[useSyncJobs] Failed to fetch sync jobs:", err);
      // Gracefully degrade — sync history is non-critical
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [pb, user, limit]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return { jobs, loading, refetch: fetchJobs };
}
