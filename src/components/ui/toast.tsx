"use client";

import { useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in on next frame
    requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss after 6s
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 6000);

    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const colors: Record<Toast["type"], string> = {
    success: "border-green-500/30 bg-green-500/10 text-green-400",
    error: "border-red-500/30 bg-red-500/10 text-red-400",
    info: "border-white/20 bg-white/10 text-white/70",
  };

  const icons: Record<Toast["type"], string> = {
    success: "✓",
    error: "✗",
    info: "ℹ",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm transition-all duration-300 max-w-sm",
        colors[toast.type],
        visible
          ? "translate-x-0 opacity-100"
          : "translate-x-4 opacity-0",
      )}
    >
      <span className="mt-0.5 font-bold">{icons[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => onDismiss(toast.id), 300);
        }}
        className="text-current opacity-50 hover:opacity-100"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
      {toasts.slice(0, 5).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

/**
 * Hook for imperative toast control from any component.
 * Must be used inside a ToastProvider.
 */
import { createContext, useContext } from "react";

interface ToastContextValue {
  addToast: (type: Toast["type"], message: string) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}
