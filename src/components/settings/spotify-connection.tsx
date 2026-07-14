"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/components/layout/providers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SpotifyConn {
  id: string;
  platform_username?: string;
  token_expires_at?: string;
}

/**
 * Generates a random state string for CSRF protection and initiates
 * the Spotify OAuth flow by redirecting to /api/spotify/auth.
 */
function connectSpotify() {
  const state = crypto.randomUUID();
  sessionStorage.setItem("spotify_auth_state", state);
  window.location.href = `/api/spotify/auth?state=${encodeURIComponent(state)}`;
}

/**
 * Displays Spotify connection status and provides Connect/Disconnect actions.
 * The OAuth flow is fully in-browser — no SSH needed.
 */
export function SpotifyConnection() {
  const { pb, user } = useAuth();
  const [connection, setConnection] = useState<SpotifyConn | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchConnection = useCallback(async () => {
    if (!user) return;
    try {
      const result = await pb.collection("user_connections").getList(1, 1, {
        filter: `user = "${user.id}" && platform = "spotify"`,
      });
      setConnection(result.items[0] ?? null);
    } catch {
      // collection might not exist yet — ignore
    } finally {
      setLoading(false);
    }
  }, [pb, user]);

  useEffect(() => {
    fetchConnection();
  }, [fetchConnection]);

  // Handle OAuth callback messages from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("error");
    const success = params.get("success");

    if (success === "spotify_connected") {
      setStatusMsg("Spotify connected successfully!");
      fetchConnection();
      // Clean up URL
      window.history.replaceState({}, "", "/settings");
    } else if (error) {
      const messages: Record<string, string> = {
        spotify_auth_denied: "Authorization was denied.",
        missing_params: "Missing OAuth parameters.",
        csrf_mismatch: "Security check failed. Please try again.",
        token_exchange_failed: "Failed to exchange authorization code.",
        profile_fetch_failed: "Failed to fetch Spotify profile.",
        spotify_not_configured:
          "Spotify is not configured on the server. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET.",
        internal_error: "An internal error occurred. Please try again.",
      };
      setStatusMsg(messages[error] ?? `Error: ${error}`);
      window.history.replaceState({}, "", "/settings");
    }
  }, [fetchConnection]);

  async function disconnect() {
    if (!connection) return;
    try {
      await pb.collection("user_connections").delete(connection.id);
      setConnection(null);
      setStatusMsg("Spotify disconnected.");
    } catch {
      setStatusMsg("Failed to disconnect.");
    }
  }

  if (loading) {
    return <div className="h-9 w-48 animate-pulse rounded bg-white/5" />;
  }

  return (
    <div className="space-y-3">
      {statusMsg && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${
            statusMsg.includes("success") || statusMsg.includes("connected")
              ? "border-green-500/20 bg-green-500/10 text-green-300"
              : "border-yellow-500/20 bg-yellow-500/10 text-yellow-300"
          }`}
        >
          {statusMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {connection ? (
            <>
              <Badge variant="success">Connected</Badge>
              <span className="text-sm text-white/60">
                {connection.platform_username ?? "Spotify account"}
              </span>
            </>
          ) : (
            <>
              <Badge variant="default">Not connected</Badge>
              <span className="text-sm text-white/40">
                Connect to enable Spotify playlist syncing
              </span>
            </>
          )}
        </div>

        {connection ? (
          <Button variant="secondary" size="sm" onClick={disconnect}>
            Disconnect
          </Button>
        ) : (
          <Button size="sm" onClick={connectSpotify}>
            Connect Spotify
          </Button>
        )}
      </div>
    </div>
  );
}
