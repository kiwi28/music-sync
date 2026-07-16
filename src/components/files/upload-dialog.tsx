"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { Playlist } from "@/lib/types";
import { usePlaylists } from "@/hooks/use-playlists";
import { Upload, X, Music, FolderPlus } from "lucide-react";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: (
    files: File[],
    playlistId: string | null,
    newPlaylistName: string | null,
  ) => Promise<boolean>;
}

export function UploadDialog({ open, onClose, onUpload }: UploadDialogProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [destination, setDestination] = useState<"existing" | "new">("existing");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>("");
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { playlists } = usePlaylists();

  const handleFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    setFiles((prev) => [...prev, ...Array.from(newFiles)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleSubmit = async () => {
    if (files.length === 0) return;
    if (destination === "existing" && !selectedPlaylistId) return;
    if (destination === "new" && !newPlaylistName.trim()) return;

    setUploading(true);
    const success = await onUpload(
      files,
      destination === "existing" ? selectedPlaylistId : null,
      destination === "new" ? newPlaylistName.trim() : null,
    );
    setUploading(false);

    if (success) {
      setFiles([]);
      setSelectedPlaylistId("");
      setNewPlaylistName("");
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Upload Music</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* File drop zone */}
        <div
          className={`mb-4 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragOver
              ? "border-white/40 bg-white/10"
              : "border-white/10 hover:border-white/20"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="mx-auto mb-2 h-8 w-8 text-white/30" />
          <p className="text-sm text-white/50">
            Drop audio files here or click to browse
          </p>
          <p className="mt-1 text-xs text-white/25">
            MP3, FLAC, M4A, OGG, WAV, Opus
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* Selected files list */}
        {files.length > 0 && (
          <div className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-white/5 bg-white/5 p-2">
            {files.map((file, i) => (
              <div
                key={`${file.name}-${i}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-sm"
              >
                <Music className="h-3.5 w-3.5 flex-shrink-0 text-white/30" />
                <span className="min-w-0 flex-1 truncate text-white/70">
                  {file.name}
                </span>
                <span className="flex-shrink-0 text-xs text-white/30">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(i);
                  }}
                  className="flex-shrink-0 rounded p-0.5 text-white/30 hover:bg-white/10 hover:text-white/70"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Destination */}
        <div className="mb-4 space-y-3">
          <p className="text-sm font-medium text-white/70">Add to</p>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={destination === "existing" ? "primary" : "secondary"}
              onClick={() => setDestination("existing")}
            >
              <Music className="mr-1.5 h-3.5 w-3.5" />
              Existing Playlist
            </Button>
            <Button
              size="sm"
              variant={destination === "new" ? "primary" : "secondary"}
              onClick={() => setDestination("new")}
            >
              <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
              New Playlist
            </Button>
          </div>

          {destination === "existing" ? (
            <Select
              label=""
              value={selectedPlaylistId}
              onChange={(e) => setSelectedPlaylistId(e.target.value)}
              disabled={playlists.length === 0}
              options={[
                { value: "", label: "Select a playlist…" },
                ...playlists.map((p: Playlist) => ({
                  value: p.id,
                  label: `${p.name} (${p.platform})`,
                })),
              ]}
            />
          ) : (
            <Input
              type="text"
              label=""
              placeholder="New playlist name…"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              maxLength={200}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={
              files.length === 0 ||
              uploading ||
              (destination === "existing" && !selectedPlaylistId) ||
              (destination === "new" && !newPlaylistName.trim())
            }
          >
            {uploading ? "Uploading…" : `Upload ${files.length} file(s)`}
          </Button>
        </div>
      </div>
    </div>
  );
}
