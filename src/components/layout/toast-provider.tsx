"use client";

import React, {
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  ToastContainer,
  ToastContext,
  type Toast,
} from "@/components/ui/toast";
import { useAuth } from "@/components/layout/providers";

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { pb, user } = useAuth();

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = String(++toastId);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to sync_jobs SSE for job completion/failure toasts
  useEffect(() => {
    if (!pb || !user) return;

    let active = true;

    pb.collection("sync_jobs")
      .subscribe("*", (e) => {
        if (!active) return;

        // Only toast on terminal state transitions
        if (e.action === "update") {
          const record = e.record;
          const playlistName =
            record.expand?.playlist?.name ?? "Playlist";

          if (record.status === "completed") {
            const tracks = record.tracks_added
              ? ` — +${record.tracks_added} tracks`
              : "";
            addToast(
              "success",
              `"${playlistName}" sync complete${tracks}`,
            );
          } else if (record.status === "failed") {
            const reason = record.error
              ? ` — ${record.error.slice(0, 80)}${record.error.length > 80 ? "…" : ""}`
              : "";
            addToast(
              "error",
              `"${playlistName}" sync failed${reason}`,
            );
          }
        }
      })
      .catch(() => {
        // SSE subscription failed — non-critical, toasts just won't fire
      });

    return () => {
      active = false;
    };
  }, [pb, user, addToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
