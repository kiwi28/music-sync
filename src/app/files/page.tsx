"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Filemanager, WillowDark } from "@svar-ui/react-filemanager";
import type { IEntity } from "@svar-ui/react-filemanager";
import "@svar-ui/react-filemanager/all.css";
import "./files.css";

import { useFileBrowser } from "@/hooks/use-files";
import { UploadDialog } from "@/components/files/upload-dialog";
import { fileIconProvider } from "@/components/files/file-icons";
import { RefreshCw, Upload, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/toast";

export default function FilesPage() {
  const {
    browse,
    createFolder,
    deleteEntries,
    moveEntries,
    copyEntries,
    renameEntry,
    refreshM3u,
    uploadToPlaylist,
    setApi,
  } = useFileBrowser();

  const { addToast } = useToast();

  const [currentPath, setCurrentPath] = useState("/");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialData, setInitialData] = useState<IEntity[] | null>(null);
  const apiRef = useRef<any>(null);

  // ── Pre-load root data before rendering Filemanager ───
  //     SVAR needs data at mount time — we can't race useEffect against init().

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    browse("/")
      .then((entries) => {
        if (!cancelled) {
          setInitialData(entries);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load files");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [browse]);

  // ── SVAR init callback ─────────────────────────────────

  const init = useCallback(
    (api: any) => {
      apiRef.current = api;
      setApi(api);

      // Intercept file creation — for uploads, show our custom dialog.
      // For folders, let SVAR handle the UI and we handle the API call in onCreateFile.
      api.intercept("create-file", (ev: any) => {
        if (ev.file?.file) {
          // This is a file upload — intercept and show our dialog
          setUploadDialogOpen(true);
          return false; // cancel SVAR's default behaviour
        }
        // Folder creation — let it through
        return true;
      });

      // Listen for path changes to track current directory
      api.on("set-path", (ev: any) => {
        setCurrentPath(ev.id || "/");
      });
    },
    [setApi],
  );

  // ── Event handlers ─────────────────────────────────────

  const handleRequestData = useCallback(
    async (ev: { id: string }) => {
      const path = ev.id || "/";
      try {
        const entries = await browse(path);
        if (apiRef.current) {
          apiRef.current.exec("provide-data", { id: path, data: entries });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Browse failed";
        addToast("error", msg);
      }
    },
    [browse, addToast],
  );

  const handleCreateFile = useCallback(
    async (ev: { file: { name: string; type?: string }; parent: string }) => {
      if (ev.file.type === "folder") {
        const newPath = await createFolder(ev.parent, ev.file.name);
        if (newPath && apiRef.current) {
          const entries = await browse(ev.parent);
          apiRef.current.exec("provide-data", {
            id: ev.parent,
            data: entries,
          });
        }
      }
    },
    [createFolder, browse],
  );

  const handleDeleteFiles = useCallback(
    async (ev: { ids: string[] }) => {
      await deleteEntries(ev.ids);
      if (apiRef.current) {
        const entries = await browse(currentPath);
        apiRef.current.exec("provide-data", { id: currentPath, data: entries });
      }
    },
    [deleteEntries, browse, currentPath],
  );

  const handleMoveFiles = useCallback(
    async (ev: { ids: string[]; target: string }) => {
      await moveEntries(ev.ids, ev.target);
      if (apiRef.current) {
        const entries = await browse(currentPath);
        apiRef.current.exec("provide-data", { id: currentPath, data: entries });
      }
    },
    [moveEntries, browse, currentPath],
  );

  const handleCopyFiles = useCallback(
    async (ev: { ids: string[]; target: string }) => {
      const ok = await copyEntries(ev.ids, ev.target);
      if (ok && apiRef.current) {
        // Refresh the target directory so newly copied files appear
        apiRef.current.exec("provide-data", {
          id: ev.target,
          data: await browse(ev.target),
        });
        // Also refresh current path in case we copied within the same folder
        if (ev.target !== currentPath) {
          apiRef.current.exec("provide-data", {
            id: currentPath,
            data: await browse(currentPath),
          });
        }
      }
    },
    [copyEntries, browse, currentPath],
  );

  const handleRenameFile = useCallback(
    async (ev: { id: string; name: string }) => {
      const newPath = await renameEntry(ev.id, ev.name);
      if (newPath && apiRef.current) {
        const entries = await browse(currentPath);
        apiRef.current.exec("provide-data", { id: currentPath, data: entries });
      }
    },
    [renameEntry, browse, currentPath],
  );

  const handleDownloadFile = useCallback(
    async (ev: { id: string }) => {
      const name = ev.id.split("/").filter(Boolean).pop() || ev.id;
      addToast(
        "info",
        `Download not available via browser — use Navidrome to stream "${name}"`,
      );
    },
    [addToast],
  );

  // ── Custom toolbar actions ─────────────────────────────

  const handleM3uRefresh = useCallback(async () => {
    await refreshM3u(currentPath);
    if (apiRef.current) {
      const entries = await browse(currentPath);
      apiRef.current.exec("provide-data", { id: currentPath, data: entries });
    }
  }, [refreshM3u, browse, currentPath]);

  const handleUploadClick = useCallback(() => {
    setUploadDialogOpen(true);
  }, []);

  const handleUploadComplete = useCallback(
    async (
      files: File[],
      playlistId: string | null,
      newPlaylistName: string | null,
      onProgress: (percent: number) => void,
    ) => {
      return uploadToPlaylist(files, playlistId, newPlaylistName, onProgress);
    },
    [uploadToPlaylist],
  );

  // ── Render ─────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col">
      {/* Page header with custom actions */}
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Files</h1>
          <p className="mt-0.5 text-sm text-white/40">
            Browse and manage music files in{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 text-xs">/music</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleUploadClick}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/15 hover:text-white"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
          <button
            onClick={handleM3uRefresh}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-sm font-medium text-white/50 transition-colors hover:bg-white/10 hover:text-white/70"
            title="Regenerate M3U playlist file for current directory"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh M3U
          </button>
        </div>
      </div>

      {/* File manager area */}
      <div className="min-h-0 flex-1 px-2 pb-2">
        {error ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-8 text-center">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={() => {
                  setError(null);
                  setLoading(true);
                  browse("/").then((entries) => {
                    setInitialData(entries);
                    setLoading(false);
                  });
                }}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/20"
              >
                Retry
              </button>
            </div>
          </div>
        ) : loading || !initialData ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              <p className="text-sm text-white/40">Loading file browser…</p>
            </div>
          </div>
        ) : (
          <WillowDark fonts={true}>
            <Filemanager
              data={initialData}
              init={init}
              mode="table"
              preview={false}
              icons={fileIconProvider}
              onRequestData={handleRequestData}
              onCreateFile={handleCreateFile}
              onDeleteFiles={handleDeleteFiles}
              onMoveFiles={handleMoveFiles}
              onCopyFiles={handleCopyFiles}
              onRenameFile={handleRenameFile}
              onDownloadFile={handleDownloadFile}
            />
          </WillowDark>
        )}
      </div>

      {/* Upload dialog */}
      <UploadDialog
        open={uploadDialogOpen}
        onClose={() => setUploadDialogOpen(false)}
        onUpload={handleUploadComplete}
      />
    </div>
  );
}
