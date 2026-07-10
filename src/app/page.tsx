"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlaylistCard } from "@/components/playlists/playlist-card";
import { SyncHistory } from "@/components/sync/sync-history";
import { usePlaylists, useSyncJobs } from "@/hooks/use-playlists";
import { useAuth } from "@/components/layout/providers";
import { PLATFORM_META } from "@/lib/utils";
import Link from "next/link";

export default function DashboardPage() {
  const { user, connectedPlatforms } = useAuth();
  const { playlists, loading: playlistsLoading } = usePlaylists();
  const { jobs, loading: jobsLoading } = useSyncJobs(5);

  const recentPlaylists = playlists.slice(0, 4);

  const stats = {
    totalPlaylists: playlists.length,
    totalTracks: playlists.reduce((sum, p) => sum + (p.track_count ?? 0), 0),
    connectedPlatforms: connectedPlatforms.length,
    recentSyncs: jobs.filter((j) => j.status === "completed").length,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back{user?.email ? `, ${user.email.split("@")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-white/40">
          Manage your music playlists across platforms
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Playlists" value={stats.totalPlaylists} loading={playlistsLoading} />
        <StatCard label="Total Tracks" value={stats.totalTracks} loading={playlistsLoading} />
        <StatCard label="Platforms Connected" value={stats.connectedPlatforms} loading={false} />
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
                  Connect a music platform in Settings to import your playlists
                </p>
                <Link
                  href="/settings"
                  className="mt-4 text-sm font-medium text-white/70 underline underline-offset-4 hover:text-white"
                >
                  Go to Settings →
                </Link>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar: sync history + platforms */}
        <div className="space-y-6">
          <SyncHistory jobs={jobs} loading={jobsLoading} />

          {/* Connected platforms */}
          <Card>
            <CardHeader>
              <CardTitle>Platforms</CardTitle>
            </CardHeader>
            <CardContent>
              {connectedPlatforms.length === 0 ? (
                <p className="py-4 text-center text-sm text-white/40">
                  No platforms connected
                </p>
              ) : (
                <div className="space-y-2">
                  {connectedPlatforms.map((platform) => {
                    const meta = PLATFORM_META[platform] ?? {
                      label: platform,
                      color: "bg-white/20",
                      icon: "🎶",
                    };
                    return (
                      <div key={platform} className="flex items-center gap-3 rounded-lg px-3 py-2">
                        <span className={`h-2 w-2 rounded-full ${meta.color}`} />
                        <span className="text-sm">{meta.label}</span>
                        <Badge variant="success">Connected</Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              <Link
                href="/settings"
                className="mt-3 inline-block text-xs text-white/40 underline underline-offset-4 hover:text-white/70"
              >
                {connectedPlatforms.length > 0 ? "Manage connections" : "Connect a platform"}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
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
