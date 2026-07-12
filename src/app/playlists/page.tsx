"use client";

import { useState, useMemo } from "react";
import { usePlaylists } from "@/hooks/use-playlists";
import { PlaylistCard, PlaylistCardSkeleton } from "@/components/playlists/playlist-card";
import { AddPlaylistDialog } from "@/components/playlists/add-playlist-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PLATFORM_META } from "@/lib/utils";

export default function PlaylistsPage() {
  const { playlists, loading, error } = usePlaylists();
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const filtered = useMemo(() => {
    return playlists.filter((p) => {
      const matchesSearch =
        !search || p.name.toLowerCase().includes(search.toLowerCase());
      const matchesPlatform =
        platformFilter === "all" || p.platform === platformFilter;
      return matchesSearch && matchesPlatform;
    });
  }, [playlists, search, platformFilter]);

  const platformOptions = [
    { value: "all", label: "All platforms" },
    ...Object.entries(PLATFORM_META).map(([value, meta]) => ({
      value,
      label: `${meta.icon} ${meta.label}`,
    })),
  ];

  const syncedCount = playlists.filter((p) => p.last_synced != null).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Playlists</h1>
          <p className="mt-1 text-sm text-white/40">
            {playlists.length} playlist{playlists.length !== 1 ? "s" : ""}
            {syncedCount > 0 && ` · ${syncedCount} synced`}
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>Add Playlist</Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Input
          placeholder="Search playlists…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          options={platformOptions}
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value)}
          className="max-w-[180px]"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Playlist grid */}
      <div className="space-y-3">
        {loading
          ? Array.from({ length: 6 }).map((_, i) => <PlaylistCardSkeleton key={i} />)
          : filtered.map((p) => <PlaylistCard key={p.id} playlist={p} />)}
      </div>

      {!loading && filtered.length === 0 && !search && (
        <div className="flex flex-col items-center py-12 text-center">
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
        </div>
      )}

      {!loading && filtered.length === 0 && search && (
        <p className="py-10 text-center text-sm text-white/40">
          No playlists match &quot;{search}&quot;
        </p>
      )}

      {/* Add playlist dialog */}
      <AddPlaylistDialog
        open={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onCreated={() => window.location.reload()}
      />
    </div>
  );
}
