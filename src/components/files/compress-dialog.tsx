"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, FileArchive, Loader2, CheckCircle2, XCircle } from "lucide-react";

export interface CompressJob {
  abort: () => void;
  done: Promise<boolean>;
}

interface CompressDialogProps {
  open: boolean;
  /** Called when the dialog is closed (including after success). */
  onClose: () => void;
  /** Start the compression. Called once when the dialog opens. */
  onStart: (
    onProgress: (percent: number) => void,
  ) => CompressJob;
}

type Phase = "compressing" | "done" | "error";

export function CompressDialog({ open, onClose, onStart }: CompressDialogProps) {
  const [phase, setPhase] = useState<Phase>("compressing");
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const jobRef = useRef<CompressJob | null>(null);
  const startedRef = useRef(false);

  // Start compression when dialog opens
  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    setPhase("compressing");
    setPercent(0);
    setError(null);

    const job = onStart((pct) => setPercent(pct));
    jobRef.current = job;

    job.done.then((ok) => {
      if (ok) {
        setPhase("done");
        setPercent(100);
      } else if (!ok) {
        // If cancelled (aborted), just close silently
        setPhase("error");
        setError("Compression was cancelled");
      }
    }).catch((err) => {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Compression failed");
    });
  }, [open, onStart]);

  // Reset when closed
  const handleClose = useCallback(() => {
    startedRef.current = false;
    jobRef.current = null;
    onClose();
  }, [onClose]);

  const handleCancel = useCallback(() => {
    jobRef.current?.abort();
    handleClose();
  }, [handleClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "compressing") handleClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && phase !== "compressing") handleClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {phase === "compressing" && "Compressing…"}
            {phase === "done" && "Ready!"}
            {phase === "error" && "Failed"}
          </h2>
          {phase !== "compressing" && (
            <button
              onClick={handleClose}
              className="rounded-lg p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex flex-col items-center gap-4 py-4">
          {/* Icon */}
          {phase === "compressing" && (
            <div className="relative">
              <FileArchive className="h-12 w-12 text-white/30" />
              <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-white/60" />
            </div>
          )}
          {phase === "done" && (
            <CheckCircle2 className="h-12 w-12 text-green-400" />
          )}
          {phase === "error" && (
            <XCircle className="h-12 w-12 text-red-400" />
          )}

          {/* Progress bar */}
          <div className="w-full">
            <div className="mb-1 flex justify-between text-xs text-white/50">
              <span>
                {phase === "compressing"
                  ? `${percent}%`
                  : phase === "done"
                    ? "Download starting…"
                    : "Cancelled"}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  phase === "error" ? "bg-red-500" : "bg-white/60"
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {error && (
            <p className="text-center text-sm text-red-400">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex justify-end gap-2">
          {phase === "compressing" && (
            <button
              onClick={handleCancel}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              Cancel
            </button>
          )}
          {phase === "done" && (
            <button
              onClick={handleClose}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              Close
            </button>
          )}
          {phase === "error" && (
            <button
              onClick={handleClose}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
