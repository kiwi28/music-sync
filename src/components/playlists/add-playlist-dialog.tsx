"use client";

import { useState } from "react";
import { useAuth } from "@/components/layout/providers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_META } from "@/lib/utils";
import { detectPlatformFromUrl, extractPlatformIdFromUrl } from "@/lib/url-utils";
import type { Platform } from "@/lib/types";

interface AddPlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

export function AddPlaylistDialog({ open, onClose, onCreated }: AddPlaylistDialogProps) {
  const { pb, user } = useAuth();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedPlatform: Platform | null = url ? detectPlatformFromUrl(url) : null;
  const meta = detectedPlatform ? PLATFORM_META[detectedPlatform] : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!user) {
      setError("You must be logged in");
      return;
    }

    if (!detectedPlatform) {
      setError("Could not detect a supported music platform from this URL");
      return;
    }

    const platformId = extractPlatformIdFromUrl(url, detectedPlatform) ?? undefined;
    const playlistName = name.trim() || url;

    setSubmitting(true);
    try {
      // Read the user ID from the auth store directly — the React `user`
      // state can be a stale/cookie-compacted record that is missing `id`.
      const userId = pb.authStore.record?.id;
      if (!userId) {
        setError("Could not determine your user identity — please log in again.");
        setSubmitting(false);
        return;
      }

      await pb.collection("playlists").create({
        name: playlistName,
        url,
        platform: detectedPlatform,
        platform_id: platformId,
        user: userId,
      });

      setUrl("");
      setName("");
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create playlist");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold tracking-tight">Add Playlist</h2>
          <p className="mt-1 text-sm text-white/40">
            Paste a public playlist URL from any supported platform
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {/* URL input */}
            <div>
              <Input
                id="url"
                label="Playlist URL"
                type="url"
                placeholder="https://open.spotify.com/playlist/..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                autoFocus
              />
              {/* Auto-detected platform */}
              {meta && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-white/40">Detected:</span>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${meta.color}`} />
                  <span className="text-xs font-medium text-white/60">
                    {meta.icon} {meta.label}
                  </span>
                </div>
              )}
              {url && !detectedPlatform && (
                <p className="mt-2 text-xs text-amber-400/60">
                  Could not detect a supported music platform from this URL
                </p>
              )}
            </div>

            {/* Name override */}
            <Input
              id="name"
              label="Name (optional)"
              type="text"
              placeholder="Leave blank to use the URL"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="secondary"
                className="flex-1"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={submitting || !detectedPlatform}
              >
                {submitting ? "Adding…" : "Add Playlist"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
