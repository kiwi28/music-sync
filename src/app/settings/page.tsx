"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/layout/providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLATFORM_META } from "@/lib/utils";
import type { Platform } from "@/lib/types";

const AVAILABLE_PLATFORMS: { id: Platform; label: string; description: string }[] = [
  { id: "spotify", label: "Spotify", description: "Connect your Spotify account to import playlists and tracks" },
  { id: "apple_music", label: "Apple Music", description: "Coming soon — Apple Music integration" },
  { id: "youtube_music", label: "YouTube Music", description: "Coming soon — YouTube Music integration" },
  { id: "tidal", label: "Tidal", description: "Coming soon — Tidal integration" },
];

export default function SettingsPage() {
  const { user, logout, connectedPlatforms, pb, refreshConnections } = useAuth();
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [importingPlaylists, setImportingPlaylists] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  // Prevent re-processing the same params on re-renders
  const processedKey = useRef<string | null>(null);

  // Read error/success from URL, show it, and clean the URL
  useEffect(() => {
    const error = searchParams.get("error");
    const success = searchParams.get("success");

    // Nothing to do
    if (!error && !success) return;

    // Already processed this exact combination
    const key = `${error ?? ""}|${success ?? ""}`;
    if (processedKey.current === key) return;
    processedKey.current = key;

    if (error) {
      const messages: Record<string, string> = {
        spotify_auth_denied: "Spotify authorization was denied.",
        missing_params: "Missing parameters in Spotify callback.",
        csrf_mismatch: "Security check failed. Please try again.",
        not_authenticated: "Your session expired. Please log in again.",
        spotify_not_configured: "Spotify integration is not configured on the server.",
        token_exchange_failed: "Failed to exchange Spotify authorization code.",
        profile_fetch_failed: "Failed to fetch your Spotify profile.",
        pb_unreachable: "The database is temporarily unavailable. Please try again in a moment.",
        pb_write_failed: "Failed to save your Spotify connection. Please try again.",
        internal_error: "An unexpected error occurred. Please try again.",
      };
      setStatusMessage({ type: "error", text: messages[error] ?? `Error: ${error}` });
    } else if (success) {
      setStatusMessage({ type: "success", text: "Spotify connected successfully!" });
    }

    // Clean the URL
    router.replace("/settings");
  }, [searchParams, router]);

  async function handleImportSpotifyPlaylists() {
    setImportingPlaylists(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/spotify/import", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data.message);
        window.location.reload();
      } else {
        setImportResult(`Error: ${data.error}`);
      }
    } catch {
      setImportResult("Failed to import playlists");
    } finally {
      setImportingPlaylists(false);
    }
  }

  async function handleConnectSpotify() {
    // Generate a CSRF state token and store it as a PocketBase record
    // For simplicity, we use a random string
    const state = crypto.randomUUID();

    // Store state in sessionStorage to verify on callback
    sessionStorage.setItem("spotify_auth_state", state);

    // Redirect to our Spotify auth endpoint
    window.location.href = `/api/spotify/auth?state=${encodeURIComponent(state)}`;
  }

  async function handleDisconnect(platform: Platform) {
    if (!user) return;
    setDisconnecting(platform);
    try {
      const connections = await pb
        .collection("user_connections")
        .getFullList({ filter: `user = "${user.id}" && platform = "${platform}"` });

      for (const conn of connections) {
        await pb.collection("user_connections").delete(conn.id);
      }
      await refreshConnections();
    } catch (err) {
      console.error("Failed to disconnect:", err);
    } finally {
      setDisconnecting(null);
    }
  }

  const isConnected = (platform: string) => connectedPlatforms.includes(platform as Platform);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-white/40">
          Manage your account and platform connections
        </p>
      </div>

      {/* Status messages (from OAuth callbacks) */}
      {statusMessage && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            statusMessage.type === "error"
              ? "border-red-500/20 bg-red-500/10 text-red-300"
              : "border-green-500/20 bg-green-500/10 text-green-300"
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Account */}
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">{user?.email}</p>
              <p className="text-xs text-white/40">Email address</p>
            </div>
            <Button variant="secondary" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Platform connections */}
      <Card>
        <CardHeader>
          <CardTitle>Music Platforms</CardTitle>
          <CardDescription>
            Connect your music streaming accounts to sync playlists
          </CardDescription>
          {importResult && (
            <div className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              {importResult}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {AVAILABLE_PLATFORMS.map((platform) => {
            const connected = isConnected(platform.id);
            const meta = PLATFORM_META[platform.id] ?? { label: platform.id, color: "bg-white/20" };

            return (
              <div
                key={platform.id}
                className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] p-4"
              >
                <div className="flex items-center gap-3">
                  <span className={`h-3 w-3 rounded-full ${meta.color}`} />
                  <div>
                    <p className="text-sm font-medium">{platform.label}</p>
                    <p className="text-xs text-white/40">{platform.description}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {connected ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="success">Connected</Badge>
                      {platform.id === "spotify" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={handleImportSpotifyPlaylists}
                          disabled={importingPlaylists}
                        >
                          {importingPlaylists ? "Importing…" : "Import Playlists"}
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDisconnect(platform.id)}
                        disabled={disconnecting === platform.id}
                      >
                        {disconnecting === platform.id ? "Removing…" : "Disconnect"}
                      </Button>
                    </div>
                  ) : platform.id === "spotify" ? (
                    <Button size="sm" onClick={handleConnectSpotify}>
                      Connect Spotify
                    </Button>
                  ) : (
                    <Badge variant="default">Coming soon</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Danger zone */}
      <Card className="border-red-500/20">
        <CardHeader>
          <CardTitle className="text-red-400">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Delete all data</p>
              <p className="text-xs text-white/40">
                Remove all playlists, tracks, and sync history
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!user) return;
                const confirmed = confirm(
                  "This will delete all your playlists and synced data. This cannot be undone. Continue?"
                );
                if (!confirmed) return;

                // Delete user's playlists, tracks, connections, and sync jobs
                try {
                  const playlists = await pb.collection("playlists").getFullList({
                    filter: `user = "${user.id}"`,
                  });
                  for (const p of playlists) {
                    await pb.collection("playlists").delete(p.id);
                  }

                  const connections = await pb.collection("user_connections").getFullList({
                    filter: `user = "${user.id}"`,
                  });
                  for (const c of connections) {
                    await pb.collection("user_connections").delete(c.id);
                  }

                  const jobs = await pb.collection("sync_jobs").getFullList({
                    filter: `user = "${user.id}"`,
                  });
                  for (const j of jobs) {
                    await pb.collection("sync_jobs").delete(j.id);
                  }

                  window.location.reload();
                } catch (err) {
                  console.error("Failed to delete data:", err);
                  alert("Failed to delete data. Please try again.");
                }
              }}
            >
              Delete all data
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
