"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_META, timeAgo, truncate } from "@/lib/utils";
import type { Playlist } from "@/lib/types";

interface PlaylistCardProps {
  playlist: Playlist;
  isSyncing?: boolean;
}

export function PlaylistCard({ playlist, isSyncing }: PlaylistCardProps) {
  const meta = PLATFORM_META[playlist.platform] ?? {
    label: playlist.platform,
    color: "bg-white/20",
    icon: "🎶",
  };

  return (
    <Link href={`/playlists/${playlist.id}`}>
      <Card className="group cursor-pointer transition-all hover:border-white/20 hover:bg-white/[0.07]">
        <CardContent className="flex items-center gap-4 p-4">
          {/* Cover art */}
          <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg bg-white/5">
            {playlist.cover_url ? (
              <img
                src={playlist.cover_url}
                alt={playlist.name}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-2xl">
                {meta.icon}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <h4 className="truncate text-sm font-medium group-hover:text-white">
              {playlist.name}
            </h4>
            <div className="mt-1 flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />
              <span className="text-xs text-white/40">{meta.label}</span>
              {playlist.track_count != null && (
                <span className="text-xs text-white/30">
                  {playlist.track_count} tracks
                </span>
              )}
            </div>
            {playlist.url && (
              <p className="mt-0.5 truncate text-[11px] text-white/20">
                {truncate(playlist.url.replace(/^https?:\/\/(www\.)?/, ""), 45)}
              </p>
            )}
          </div>

          {/* Meta */}
          <div className="flex flex-col items-end gap-1.5">
            {isSyncing ? (
              <span className="flex items-center gap-1.5 text-[11px] text-amber-400/80">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                Syncing…
              </span>
            ) : !playlist.last_synced ? (
              <span className="text-[11px] text-amber-400/60">Needs sync</span>
            ) : (
              <Badge variant="success">
                Synced {timeAgo(playlist.last_synced)}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function PlaylistCardSkeleton() {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-4">
        <div className="h-14 w-14 flex-shrink-0 animate-pulse rounded-lg bg-white/5" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
        </div>
      </CardContent>
    </Card>
  );
}
