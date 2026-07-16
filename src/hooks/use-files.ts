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
        return {
          id,
          name: entry.name,
          type: entry.isDirectory ? ("folder" as const) : ("file" as const),
          size: entry.size,
          date: new Date(),
          ext: entry.ext,
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
   * Upload files to a playlist.
   * Called from our custom UploadDialog, not from SVAR directly.
   */
  const uploadToPlaylist = useCallback(
    async (
      files: File[],
      playlistId: string | null,
      newPlaylistName: string | null,
    ): Promise<boolean> => {
      try {
        const formData = new FormData();
        for (const file of files) {
          formData.append("files", file);
        }
        if (playlistId) formData.append("playlistId", playlistId);
        if (newPlaylistName) formData.append("newPlaylistName", newPlaylistName);

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Upload failed");
        }

        const { tracksAdded } = await res.json();
        addToast("success", `Uploaded ${tracksAdded} track(s)`);
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
  };
}
