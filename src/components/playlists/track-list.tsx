"use client";

import { formatDuration } from "@/lib/utils";
import type { PlaylistTrack } from "@/lib/types";

interface TrackListProps {
  tracks: PlaylistTrack[];
  loading?: boolean;
}

export function TrackList({ tracks, loading }: TrackListProps) {
  if (loading) {
    return (
      <div className="space-y-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg px-3 py-2"
          >
            <div className="w-5 text-right text-xs text-white/20">{i + 1}</div>
            <div className="h-8 w-8 animate-pulse rounded bg-white/5" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-white/5" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-white/5" />
            </div>
            <div className="h-3 w-10 animate-pulse rounded bg-white/5" />
          </div>
        ))}
      </div>
    );
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-white/40">No tracks in this playlist</p>
        <p className="mt-1 text-xs text-white/25">
          Sync this playlist with a music platform to import tracks
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {tracks
        .sort((a, b) => a.position - b.position)
        .map((pt, i) => {
          // PocketBase expanded relations: use expand.track for the resolved object
          const track = pt.expand?.track ?? (typeof pt.track === "object" ? pt.track : null);
          if (!track || typeof track === "string") return null;

          return (
            <div
              key={pt.id}
              className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-white/[0.04]"
            >
              {/* Position */}
              <div className="w-5 flex-shrink-0 text-right text-xs tabular-nums text-white/20">
                {i + 1}
              </div>

              {/* Album art */}
              <div className="h-8 w-8 flex-shrink-0 overflow-hidden rounded bg-white/5">
                {track.cover_url ? (
                  <img
                    src={track.cover_url}
                    alt={track.album ?? ""}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-white/20">
                    ♫
                  </div>
                )}
              </div>

              {/* Track info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{track.title}</p>
                <p className="truncate text-xs text-white/40">
                  {track.artist}
                  {track.album && (
                    <>
                      {" "}
                      <span className="text-white/20">·</span>{" "}
                      <span className="text-white/30">{track.album}</span>
                    </>
                  )}
                </p>
              </div>

              {/* Duration */}
              {track.duration_ms && (
                <div className="flex-shrink-0 text-xs tabular-nums text-white/30">
                  {formatDuration(track.duration_ms)}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
