"use client";

import { useState, useCallback, useRef } from "react";
import type { IEntity, IApi } from "@svar-ui/react-filemanager";
import { useToast } from "@/components/ui/toast";

// ── Types ──────────────────────────────────────────────

interface BrowseResponse {
  path: string;
  entries: {
    name: string;
    isDirectory: boolean;
    size?: number;
    ext?: string;
  }[];
}

export interface UploadFile {
  file: File;
  name: string;
  size: number;
}

// ── Hook ───────────────────────────────────────────────

export function useFileBrowser() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiRef = useRef<IApi | null>(null);
  const { addToast } = useToast();

  /** Register the SVAR API instance for imperative calls like provide-data. */
  const setApi = useCallback((api: IApi) => {
    apiRef.current = api;
  }, []);

  /**
   * Fetch directory contents and return SVAR-compatible entities.
   * Called by onRequestData for lazy loading.
   */
  const browse = useCallback(async (path: string): Promise<IEntity[]> => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (path && path !== "/") params.set("path", path);

      const res = await fetch(`/api/files/browse?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to browse directory");
      }

      const { entries } = (await res.json()) as BrowseResponse;

      return entries.map((entry) => {
        const id = path.endsWith("/")
          ? `${path}${entry.name}`
          : `${path}/${entry.name}`;
        const isFolder = entry.isDirectory;
        return {
          id,
          name: entry.name,
          type: isFolder ? ("folder" as const) : ("file" as const),
          size: entry.size,
          date: new Date(),
          ext: entry.ext,
          // SVAR requires `lazy: true` on folders to fire onRequestData
          // when the user opens them. Without it, folders show as empty.
          lazy: isFolder ? true : undefined,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Browse failed";
      setError(msg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Create a new folder.
   * Called by SVAR's onCreateFile event.
   */
  const createFolder = useCallback(
    async (parentPath: string, name: string): Promise<string | null> => {
      try {
        const res = await fetch("/api/files/folder", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: parentPath, name }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to create folder");
        }

        addToast("success", `Folder "${name}" created`);

        const parent = parentPath === "/" ? "" : parentPath;
        return `${parent}/${name}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Create folder failed";
        addToast("error", msg);
        return null;
      }
    },
    [addToast],
  );

  /**
   * Delete files/folders.
   * Called by SVAR's onDeleteFiles event.
   */
  const deleteEntries = useCallback(
    async (ids: string[]): Promise<boolean> => {
      let allOk = true;
      for (const id of ids) {
        try {
          const res = await fetch("/api/files", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: id }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to delete");
          }

          const name = id.split("/").filter(Boolean).pop() || id;
          addToast("success", `Deleted "${name}"`);
        } catch (err) {
          allOk = false;
          const msg = err instanceof Error ? err.message : "Delete failed";
          addToast("error", msg);
        }
      }
      return allOk;
    },
    [addToast],
  );

  /**
   * Move/rename files/folders.
   * Called by SVAR's onMoveFiles event.
   */
  const moveEntries = useCallback(
    async (ids: string[], target: string): Promise<boolean> => {
      let allOk = true;
      for (const id of ids) {
        const name = id.split("/").filter(Boolean).pop() || id;
        const to = target === "/" ? `/${name}` : `${target}/${name}`;
        try {
          const res = await fetch("/api/files/move", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: id, to }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to move");
          }

          addToast("success", `Moved "${name}"`);
        } catch (err) {
          allOk = false;
          const msg = err instanceof Error ? err.message : "Move failed";
          addToast("error", msg);
        }
      }
      return allOk;
    },
    [addToast],
  );

  /**
   * Copy files/folders by moving them to the target (file copy for reflinks
   * is not yet supported at the API level — the /api/files/move endpoint
   * renames/moves; we issue a POST to copy by listing all descendants, then
   * reading and re-writing each file).
   *
   * For now, directories are handled by noting the limitation. For files
   * within the same filesystem, we use the files/copy endpoint.
   */
  const copyEntries = useCallback(
    async (ids: string[], target: string): Promise<boolean> => {
      let allOk = true;
      for (const id of ids) {
        const name = id.split("/").filter(Boolean).pop() || id;
        const to = target === "/" ? `/${name}` : `${target}/${name}`;

        try {
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ from: id, to }),
          });

          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "Failed to copy");
          }

          addToast("success", `Copied "${name}"`);
        } catch (err) {
          allOk = false;
          const msg = err instanceof Error ? err.message : "Copy failed";
          addToast("error", msg);
        }
      }
      return allOk;
    },
    [addToast],
  );

  /**
   * Rename a file/folder.
   * Called by SVAR's onRenameFile event.
   */
  const renameEntry = useCallback(
    async (id: string, name: string): Promise<string | null> => {
      try {
        const segments = id.split("/").filter(Boolean);
        segments[segments.length - 1] = name;
        const newPath = "/" + segments.join("/");

        const res = await fetch("/api/files/move", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: id, to: newPath }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to rename");
        }

        addToast("success", `Renamed to "${name}"`);
        return newPath;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Rename failed";
        addToast("error", msg);
        return null;
      }
    },
    [addToast],
  );

  /**
   * Refresh the M3U file for a given directory.
   */
  const refreshM3u = useCallback(
    async (dirPath: string) => {
      try {
        const res = await fetch("/api/files/m3u", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: dirPath }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to refresh M3U");
        }

        const { trackCount } = await res.json();
        addToast("success", `M3U refreshed (${trackCount} tracks)`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "M3U refresh failed";
        addToast("error", msg);
      }
    },
    [addToast],
  );

  /**
   * Compress one or more paths to a ZIP with progress tracking.
   *
   * Returns `{ abort, done }`:
   * - `abort()` cancels the compression and cleans up on the server.
   * - `done` resolves to `true` when the ZIP has been downloaded, `false` on error/cancel.
   * - `onProgress` receives percent (0–100) during compression.
   */
  const compressToZip = useCallback(
    (
      paths: string[],
      onProgress?: (percent: number) => void,
    ): { abort: () => void; done: Promise<boolean> } => {
      const ac = new AbortController();
      let jobId: string | null = null;

      const done = (async (): Promise<boolean> => {
        try {
          // 1. Start compression job
          const res = await fetch("/api/files/compress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paths }),
            signal: ac.signal,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "Compression failed");
          }

          const body = await res.json();
          jobId = body.jobId as string;

          // 2. Poll for progress
          let lastPct = 0;
          while (!ac.signal.aborted) {
            await new Promise((r) => setTimeout(r, 100));

            const pRes = await fetch(
              `/api/files/compress?jobId=${encodeURIComponent(jobId!)}`,
              { signal: ac.signal },
            );

            if (!pRes.ok) throw new Error("Progress check failed");

            const p = await pRes.json();

            if (p.status === "error") {
              throw new Error(p.error || "Compression failed");
            }

            if (p.status === "cancelled") return false;

            if (p.percent !== lastPct) {
              lastPct = p.percent;
              onProgress?.(p.percent);
            }

            if (p.status === "ready") break;
          }

          if (ac.signal.aborted) return false;

          // 3. Download the archive
          onProgress?.(100);

          const dlRes = await fetch(
            `/api/files/compress/download?jobId=${encodeURIComponent(jobId!)}`,
          );

          if (!dlRes.ok) {
            const data = await dlRes.json().catch(() => ({}));
            throw new Error(data.error || "Download failed");
          }

          const blob = await dlRes.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "archive.zip";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          return true;
        } catch (err) {
          if (ac.signal.aborted) return false;
          const msg =
            err instanceof Error ? err.message : "Compression failed";
          addToast("error", msg);
          return false;
        }
      })();

      return {
        abort: () => {
          ac.abort();
          if (jobId) {
            fetch(
              `/api/files/compress?jobId=${encodeURIComponent(jobId)}`,
              { method: "DELETE" },
            ).catch(() => {});
          }
        },
        done,
      };
    },
    [addToast],
  );

  /**
   * Unzip a ZIP file in place (same directory).
   * Returns true on success, false on failure.
   */
  const unzipFile = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        const res = await fetch("/api/files/unzip", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Extraction failed");
        }

        const { extractedCount } = await res.json();
        addToast("success", `Extracted ${extractedCount} file(s)`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Extraction failed";
        addToast("error", msg);
        return false;
      }
    },
    [addToast],
  );

  /**
   * Upload files to a playlist.
   * Uses XMLHttpRequest instead of fetch to get upload progress events.
   */
  const uploadToPlaylist = useCallback(
    async (
      files: File[],
      playlistId: string | null,
      newPlaylistName: string | null,
      onProgress?: (percent: number) => void,
    ): Promise<boolean> => {
      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file);
        }
        if (playlistId) formData.append("playlistId", playlistId);
        if (newPlaylistName) formData.append("newPlaylistName", newPlaylistName);

        // XMLHttpRequest gives us upload progress — fetch doesn't.
        const result = await new Promise<{ tracksAdded: number }>(
          (resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/files/upload");

            xhr.upload.addEventListener("progress", (ev) => {
              if (ev.lengthComputable && onProgress) {
                const pct = Math.round((ev.loaded / ev.total) * 100);
                onProgress(pct);
              }
            });

            xhr.addEventListener("load", () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                resolve(JSON.parse(xhr.responseText));
              } else {
                try {
                  const data = JSON.parse(xhr.responseText);
                  reject(new Error(data.error || `Upload failed (${xhr.status})`));
                } catch {
                  reject(new Error(`Upload failed (${xhr.status})`));
                }
              }
            });

            xhr.addEventListener("error", () =>
              reject(new Error("Network error during upload")),
            );
            xhr.addEventListener("abort", () =>
              reject(new Error("Upload cancelled")),
            );

            xhr.send(formData);
          },
        );

        addToast("success", `Uploaded ${result.tracksAdded} track(s)`);
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        addToast("error", msg);
        return false;
      }
    },
    [addToast],
  );

  return {
    loading,
    error,
    setApi,
    browse,
    createFolder,
    deleteEntries,
    moveEntries,
    copyEntries,
    renameEntry,
    refreshM3u,
    uploadToPlaylist,
    compressToZip,
    unzipFile,
  };
}
