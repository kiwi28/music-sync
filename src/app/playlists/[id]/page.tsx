"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePlaylist, useActiveSyncJob } from "@/hooks/use-playlists";
import { useAuth } from "@/components/layout/providers";
import { TrackList } from "@/components/playlists/track-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLATFORM_META, timeAgo } from "@/lib/utils";
import { RefreshCw } from "lucide-react";

export default function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { playlist, loading, error, refetch: fetchPlaylist } = usePlaylist(id);
  const { user } = useAuth();
  const router = useRouter();
  const {
    activeJob,
    loading: syncStatusLoading,
    refetch: refetchSyncStatus,
  } = useActiveSyncJob(playlist?.id);

  const tracks = playlist?.expand?.playlist_tracks_via_playlist ?? [];
  const meta = playlist ? PLATFORM_META[playlist.platform] : null;

  async function handleSync() {
    if (!playlist || !user) return;

    // If a job is already active, just refresh the status — don't POST
    if (activeJob) {
      refetchSyncStatus();
      return;
    }

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: playlist.id,
        }),
      });

      if (!res.ok) {
        // 409 = race condition: a job was created between polls.
        // Refresh the active job instead of showing an error.
        if (res.status === 409) {
          refetchSyncStatus();
          return;
        }
        const data = await res.json();
        throw new Error(data.error || "Sync failed");
      }

      // Job created — immediately poll for it so the button updates
      refetchSyncStatus();
      router.refresh();
      fetchPlaylist();
    } catch (err) {
      console.error("[handleSync]", err);
    }
  }

  async function handleRefreshM3u() {
    if (!playlist) return;
    try {
      const res = await fetch("/api/files/m3u", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlistId: playlist.id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "M3U refresh failed");
      }

      const { trackCount } = await res.json();
      // Use a simple alert for now — toast would require the ToastProvider context
      console.log(`[m3u] Refreshed "${playlist.name}".m3u (${trackCount} tracks)`);
    } catch (err) {
      console.error("[handleRefreshM3u]", err);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-1/3 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-white/5" />
        <div className="h-[400px] animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-lg font-medium text-white/40">
          {error ? "Failed to load playlist" : "Playlist not found"}
        </p>
        {error && (
          <p className="mt-1 max-w-md text-center text-xs text-red-400/60">{error}</p>
        )}
        <div className="mt-4 flex gap-3">
          {error && (
            <Button variant="secondary" size="sm" onClick={() => fetchPlaylist()}>
              Retry
            </Button>
          )}
          <Link href="/playlists" className="text-sm text-white/60 underline underline-offset-4 hover:text-white">
            Back to playlists
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-white/30">
        <Link href="/playlists" className="hover:text-white/60">
          Playlists
        </Link>
        <span>/</span>
        <span className="text-white/50">{playlist.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          {/* Cover */}
          <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl bg-white/5">
            {playlist.cover_url ? (
              <img
                src={playlist.cover_url}
                alt={playlist.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl">
                {meta?.icon ?? "🎶"}
              </div>
            )}
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight">{playlist.name}</h1>
            {playlist.description && (
              <p className="mt-1 text-sm text-white/50">{playlist.description}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {meta && (
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />
                  <span className="text-xs text-white/40">{meta.label}</span>
                </div>
              )}
              {playlist.track_count != null && (
                <span className="text-xs text-white/30">
                  {playlist.track_count} track{playlist.track_count !== 1 ? "s" : ""}
                </span>
              )}
              {playlist.last_synced && (
                <Badge variant="success">
                  Last synced {timeAgo(playlist.last_synced)}
                </Badge>
              )}
              {playlist.url && (
                <a
                  href={playlist.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-white/40 underline underline-offset-4 hover:text-white/70"
                  onClick={(e) => e.stopPropagation()}
                >
                  Open in {meta?.label ?? "platform"} ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Sync action */}
        <div className="flex flex-col items-end gap-2">
          {activeJob?.status === "running" ? (
            <Button disabled className="cursor-not-allowed opacity-70">
              <span className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              Sync in progress…
            </Button>
          ) : activeJob?.status === "pending" ? (
            <Button disabled variant="secondary">
              Sync queued…
            </Button>
          ) : (
            <Button onClick={handleSync} disabled={syncStatusLoading}>
              Sync Now
            </Button>
          )}

          {/* Live progress / error */}
          {activeJob && (
            <div className="max-w-xs rounded-lg border border-white/10 bg-white/5 p-2.5 text-right">
              {activeJob.log && (
                <p className="text-xs text-white/60">{activeJob.log}</p>
              )}
              {activeJob.error && (
                <p className="mt-1 text-xs text-red-400">{activeJob.error}</p>
              )}
              {activeJob.status === "failed" && !activeJob.error && (
                <p className="text-xs text-red-400">Sync failed — check worker logs</p>
              )}
            </div>
          )}

          {/* Live status badge */}
          {activeJob && (
            <Badge
              variant={activeJob.status === "running" ? "warning" : activeJob.status === "failed" ? "danger" : "default"}
            >
              {activeJob.status === "running"
                ? "Downloading tracks…"
                : activeJob.status === "failed"
                ? "Sync failed"
                : "Waiting for worker…"}
            </Badge>
          )}

          {/* M3U refresh + jobs link */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleRefreshM3u}
              className="inline-flex items-center gap-1 text-xs text-white/40 underline underline-offset-4 hover:text-white/60"
              title={`Regenerate ${playlist.name}.m3u`}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh M3U
            </button>
            <Link
              href={`/jobs?playlistId=${playlist.id}`}
              className="text-xs text-white/40 underline underline-offset-4 hover:text-white/60"
            >
              View all jobs →
            </Link>
          </div>
        </div>
      </div>

      {/* Tracks */}
      <Card>
        <CardHeader>
          <CardTitle>Tracks</CardTitle>
        </CardHeader>
        <CardContent>
          <TrackList tracks={tracks} loading={false} />
        </CardContent>
      </Card>
    </div>
  );
}
