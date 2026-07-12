"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePlaylist } from "@/hooks/use-playlists";
import { useAuth } from "@/components/layout/providers";
import { TrackList } from "@/components/playlists/track-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLATFORM_META, timeAgo } from "@/lib/utils";

export default function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { playlist, loading, error } = usePlaylist(id);
  const { user } = useAuth();
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const tracks = playlist?.expand?.playlist_tracks_via_playlist ?? [];
  const meta = playlist ? PLATFORM_META[playlist.platform] : null;

  async function handleSync() {
    if (!playlist || !user) return;
    setSyncing(true);
    setSyncError(null);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlistId: playlist.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Sync failed");
      }

      router.refresh();
      window.location.reload();
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
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
            <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
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
          <Button onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>
          {syncError && (
            <p className="text-xs text-red-400">{syncError}</p>
          )}
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
