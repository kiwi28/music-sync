import "server-only";

import PocketBase from "pocketbase";
import { cookies } from "next/headers";
import { logError } from "./api-errors";

const PB_URL = process.env.POCKETBASE_URL || "http://127.0.0.1:8090";
const SOURCE = "pocketbase-server";

/** Default timeout for PocketBase API calls (10 seconds) */
const PB_TIMEOUT_MS = 10_000;

/**
 * Race a promise against a timeout. If the promise doesn't settle within
 * `ms` milliseconds, the timeout rejects with the given `label`.
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timeout: ${label} (${ms}ms)`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer);
    return result;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Create a server-side PocketBase client.
 * Reads the pb_auth cookie and loads the session so all subsequent
 * requests are authenticated as the logged-in user.
 *
 * IMPORTANT: This module uses "server-only" — importing it in a
 * client component will cause a build error.
 */
export async function createServerClient(): Promise<PocketBase> {
  const cookieStore = await cookies();
  const pb = new PocketBase(PB_URL);

  // Load auth from cookie
  const authCookie = cookieStore.get("pb_auth");
  if (authCookie) {
    try {
      // Manually parse cookie JSON — PocketBase SDK 0.27.x has a bug where
      // exportToCookie writes "record" but loadFromCookie expects "model".
      const cookieData = JSON.parse(authCookie.value);
      const token = cookieData.token || null;
      const model = cookieData.record || cookieData.model || null;

      if (!token || !model) {
        console.warn(
          "[pocketbase-server] pb_auth cookie parsed but missing fields:",
          { hasToken: !!token, hasModel: !!model, keys: Object.keys(cookieData) },
        );
      }

      pb.authStore.save(token, model);

      // Always try to refresh (PocketBase handles expired tokens)
      // Wrapped in a timeout — if PB is unreachable, fail fast instead of
      // hanging until nginx gives up and returns 503.
      if (token) {
        try {
          await withTimeout(
            pb.collection("users").authRefresh(),
            PB_TIMEOUT_MS,
            "PocketBase authRefresh",
          );
        } catch (err) {
          const status = (err as { status?: number })?.status;
          // Only clear auth on explicit 401/403 — transient errors
          // (network, 503, timeouts) should keep the session alive.
          if (status === 401 || status === 403) {
            console.error(
              "[pocketbase-server] authRefresh rejected — clearing session. status:",
              status,
              "pb_url:",
              PB_URL,
              "message:",
              (err as Error)?.message ?? err,
            );
            logError({ source: SOURCE, fn: "createServerClient", step: "authRefresh" }, err);
            pb.authStore.clear();
          } else {
            console.warn(
              "[pocketbase-server] authRefresh network error — keeping session. message:",
              (err as Error)?.message ?? err,
            );
            logError(
              { source: SOURCE, fn: "createServerClient", step: "authRefresh-retained" },
              err,
            );
            // Keep existing token — may still be valid when backend recovers.
            // The stale token in authStore will be used for this request.
          }
        }
      }
    } catch (parseErr) {
      console.error(
        "[pocketbase-server] Failed to parse pb_auth cookie:",
        parseErr instanceof Error ? parseErr.message : parseErr,
        "raw value:",
        authCookie.value.substring(0, 200),
      );
      pb.authStore.clear();
    }
  } else {
    console.warn("[pocketbase-server] No pb_auth cookie found in request");
  }

  return pb;
}

