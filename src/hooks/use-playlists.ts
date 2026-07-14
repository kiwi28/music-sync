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

/**
 * Polls for a pending or running sync_job for a specific playlist.
 * Returns the active job (if any) so the UI can show live status.
 * Polls every 5s — the query is a cheap indexed PocketBase lookup.
 */
export function useActiveSyncJob(playlistId: string | undefined) {
  const { pb, user } = useAuth();
  const [activeJob, setActiveJob] = useState<SyncJob | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActiveJob = useCallback(async () => {
    if (!user || !playlistId) {
      setActiveJob(null);
      setLoading(false);
      return;
    }
    try {
      const result = await pb.collection("sync_jobs").getList<SyncJob>(1, 1, {
        filter: `playlist = "${playlistId}" && (status = "pending" || status = "running")`,
        sort: "-created",
      });
      setActiveJob(result.items[0] ?? null);
    } catch (err) {
      console.error("[useActiveSyncJob]", err);
      setActiveJob(null);
    } finally {
      setLoading(false);
    }
  }, [pb, user, playlistId]);

  useEffect(() => {
    fetchActiveJob();
    const interval = setInterval(fetchActiveJob, 5000);
    return () => clearInterval(interval);
  }, [fetchActiveJob]);

  return { activeJob, loading, refetch: fetchActiveJob };
}

/**
 * Polls for ALL pending/running sync_jobs for the current user.
 * Returns a Set of playlist IDs that have active jobs — used by the
 * playlist list page to show syncing indicators on cards.
 * Polls every 15s to match the worker's poll interval.
 */
export function useActiveSyncJobs() {
  const { pb, user } = useAuth();
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const fetchActiveJobs = useCallback(async () => {
    if (!user) {
      setSyncingIds(new Set());
      setLoading(false);
      return;
    }
    try {
      const result = await pb.collection("sync_jobs").getList<SyncJob>(1, 50, {
        filter: `user = "${user.id}" && (status = "pending" || status = "running")`,
      });
      setSyncingIds(new Set(result.items.map((j) => j.playlist)));
    } catch (err) {
      console.error("[useActiveSyncJobs]", err);
      setSyncingIds(new Set());
    } finally {
      setLoading(false);
    }
  }, [pb, user]);

  useEffect(() => {
    fetchActiveJobs();
    const interval = setInterval(fetchActiveJobs, 15000);
    return () => clearInterval(interval);
  }, [fetchActiveJobs]);

  return { syncingIds, loading, refetch: fetchActiveJobs };
}
