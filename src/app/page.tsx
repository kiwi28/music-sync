"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PlaylistCard } from "@/components/playlists/playlist-card";
import { SyncHistory } from "@/components/sync/sync-history";
import { AddPlaylistDialog } from "@/components/playlists/add-playlist-dialog";
import { usePlaylists, useSyncJobs } from "@/hooks/use-playlists";
import { useAuth } from "@/components/layout/providers";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function DashboardPage() {
  const { user } = useAuth();
  const { playlists, loading: playlistsLoading } = usePlaylists();
  const { jobs, loading: jobsLoading } = useSyncJobs(5);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const recentPlaylists = playlists.slice(0, 4);
  const syncedCount = playlists.filter((p) => p.last_synced != null).length;

  const stats = {
    totalPlaylists: playlists.length,
    totalTracks: playlists.reduce((sum, p) => sum + (p.track_count ?? 0), 0),
    syncedPlaylists: syncedCount,
    recentSyncs: jobs.filter((j) => j.status === "completed").length,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-white/40">
            Track your music playlists across platforms
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>Add Playlist</Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Playlists" value={stats.totalPlaylists} loading={playlistsLoading} />
        <StatCard label="Total Tracks" value={stats.totalTracks} loading={playlistsLoading} />
        <StatCard label="Synced" value={stats.syncedPlaylists} loading={playlistsLoading} />
        <StatCard label="Recent Syncs" value={stats.recentSyncs} loading={jobsLoading} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Recent playlists */}
        <div className="col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-white/60">Recent Playlists</h2>
            <Link href="/playlists" className="text-xs text-white/40 underline underline-offset-4 hover:text-white/70">
              View all
            </Link>
          </div>

          {playlistsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="h-14 w-14 animate-pulse rounded-lg bg-white/5" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
                      <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : recentPlaylists.length > 0 ? (
            <div className="space-y-3">
              {recentPlaylists.map((p) => (
                <PlaylistCard key={p.id} playlist={p} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center py-10 text-center">
                <p className="text-sm text-white/40">No playlists yet</p>
                <p className="mt-1 text-xs text-white/25">
                  Paste a public playlist URL to get started
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  onClick={() => setShowAddDialog(true)}
                >
                  Add your first playlist →
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: sync history */}
        <div className="space-y-6">
          <SyncHistory jobs={jobs} loading={jobsLoading} />
        </div>
      </div>

      {/* Add playlist dialog */}
      <AddPlaylistDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onCreated={() => {
          // Trigger a refetch — the usePlaylists hook will pick up changes
          // on next render, but we reload for simplicity
          window.location.reload();
        }}
      />
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-white/40">{label}</p>
        {loading ? (
          <div className="mt-2 h-7 w-12 animate-pulse rounded bg-white/5" />
        ) : (
          <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        )}
      </CardContent>
    </Card>
  );
}
