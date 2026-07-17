"use client";

import { useState, useCallback, useRef } from "react";
import { useToast } from "@/components/ui/toast";

/**
 * Options for `useApiAction`.
 */
interface UseApiActionOptions {
  /** Toast message shown on success. Omit to suppress the success toast. */
  successMsg?: string;
  /**
   * Fallback message when the error is not an `Error` instance.
   * Defaults to `"Something went wrong"`.
   */
  errorFallback?: string;
}

/**
 * A lightweight hook that wraps any async action with:
 * - Loading state (prevents double-clicks)
 * - Success toast
 * - Error toast (extracts `err.message`)
 *
 * Usage:
 * ```ts
 * const [run, { loading }] = useApiAction(
 *   async (id: string) => {
 *     const res = await fetch(`/api/thing/${id}`, { method: "DELETE" });
 *     if (!res.ok) {
 *       const data = await res.json();
 *       throw new Error(data.error || "Delete failed");
 *     }
 *   },
 *   { successMsg: "Deleted", errorFallback: "Failed to delete" },
 * );
 *
 * // In JSX:
 * <Button onClick={() => run(item.id)} disabled={loading}>
 *   {loading ? "Deleting…" : "Delete"}
 * </Button>
 * ```
 */
export function useApiAction<Args extends unknown[]>(
  action: (...args: Args) => Promise<void>,
  { successMsg, errorFallback = "Something went wrong" }: UseApiActionOptions = {},
): [(...args: Args) => Promise<void>, { loading: boolean }] {
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();
  const actionRef = useRef(action);
  actionRef.current = action;

  const run = useCallback(
    async (...args: Args) => {
      if (loading) return;
      setLoading(true);
      try {
        await actionRef.current(...args);
        if (successMsg) {
          addToast("success", successMsg);
        }
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : errorFallback;
        addToast("error", msg);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, successMsg, errorFallback, addToast],
  );

  return [run, { loading }];
}
