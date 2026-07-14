"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/layout/providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { consumeFlash } from "@/lib/flash";
import { SpotifyConnection } from "@/components/settings/spotify-connection";

export default function SettingsPage() {
  const { user, logout, pb } = useAuth();
  const [statusMessage, setStatusMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Consume flash message from server-side redirects.
  // The flash cookie is set before the redirect and read once here — the URL
  // stays clean throughout the flow.
  useEffect(() => {
    const flash = consumeFlash();
    if (flash) {
      setStatusMessage({ type: flash.type, text: flash.message });
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-white/40">
          Manage your account
        </p>
      </div>

      {/* Status messages */}
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

      {/* Spotify connection */}
      <Card>
        <CardHeader>
          <CardTitle>Spotify</CardTitle>
          <CardDescription>
            Connect your Spotify account to sync playlists and liked songs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SpotifyConnection />
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

                  const jobs = await pb.collection("sync_jobs").getList(1, 500, {
                    filter: `user = "${user.id}"`,
                  });
                  for (const j of jobs.items) {
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
