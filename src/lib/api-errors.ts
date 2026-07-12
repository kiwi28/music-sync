import { NextResponse } from "next/server";

// ── Types ────────────────────────────────────────────

interface PocketBaseErrorLike {
  message?: string;
  status?: number;
  code?: number;
  data?: Record<string, { code: string; message: string }>;
  url?: string;
  originalError?: unknown;
}

export interface LogContext {
  source: string; // e.g. "spotify", "pocketbase", "api:sync"
  fn: string; // function name, e.g. "fetchSpotifyPlaylists"
  step?: string; // sub-step label
  userId?: string;
  requestBody?: unknown;
  url?: string; // external URL that was called
  status?: number; // HTTP status from the response
  responseBody?: string; // raw response body on failure
}

// ── Internal helpers ─────────────────────────────────

function extractPbError(err: unknown): PocketBaseErrorLike {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    return {
      message: typeof e.message === "string" ? e.message : undefined,
      status: typeof e.status === "number" ? e.status : undefined,
      code: typeof e.code === "number" ? e.code : undefined,
      data: e.data as PocketBaseErrorLike["data"],
      url: typeof e.url === "string" ? e.url : undefined,
      originalError: e.originalError,
    };
  }
  return {};
}

// ── Library-level logger (no NextResponse coupling) ──

/**
 * Log ANY external-call error with full context. Use this in library code
 * (spotify.ts, pocketbase-server.ts) as well as API routes.
 *
 * Automatically detects PocketBase ClientResponseError and extracts its
 * nested `data` payload. For plain Errors or fetch failures, logs the
 * URL, status, and response body so you never have to guess what happened.
 *
 * Usage:
 *   try { ... } catch (err) {
 *     logError({ source: "spotify", fn: "fetchSpotifyPlaylists", url, status: res.status, responseBody: body }, err);
 *     throw err;
 *   }
 */
export function logError(context: LogContext, err: unknown): void {
  const pb = extractPbError(err);
  const label = `[${context.source}::${context.fn}]${context.step ? ` step=${context.step}` : ""}`;

  // Primary message
  const message =
    pb.message ||
    (err instanceof Error ? err.message : String(err));
  console.error(`${label} — ${message}`);

  // User context
  if (context.userId) {
    console.error(`${label}   user: ${context.userId}`);
  }

  // HTTP-level details (either from PocketBase or raw fetch)
  const status = pb.status || context.status;
  const url = pb.url || context.url;
  if (status || url) {
    console.error(`${label}   status: ${status ?? "n/a"}  url: ${url ?? "n/a"}`);
  }

  // PocketBase field-level validation errors
  if (pb.data) {
    const entries = Object.entries(pb.data);
    if (entries.length > 0) {
      console.error(`${label}   validation errors:`);
      for (const [field, detail] of entries) {
        console.error(`${label}     ${field}: ${detail.message} (${detail.code})`);
      }
    }
  }

  // Raw response body from external APIs
  if (context.responseBody) {
    console.error(`${label}   response body:`, context.responseBody);
  }

  // Request body that triggered the error
  if (context.requestBody) {
    console.error(`${label}   request body:`, JSON.stringify(context.requestBody, null, 2));
  }

  // Raw error dump for unexpected errors (no status = not an HTTP error)
  if (!status && !pb.data) {
    console.error(`${label}   raw error:`, err);
  }
}

// ── API-route response builder ────────────────────────

/**
 * Build a NextResponse from a caught error.
 * Passes through PocketBase 4xx validation errors to the client.
 * Returns 500 for unexpected errors (without leaking internals).
 *
 * Usage:
 *   try { ... } catch (err) {
 *     logError({ source: "api:sync", fn: "POST" }, err);
 *     return apiErrorResponse(err, "Sync failed");
 *   }
 */
export function apiErrorResponse(err: unknown, fallbackMessage: string): NextResponse {
  const pb = extractPbError(err);

  // PocketBase validation errors (4xx) — pass through to client
  if (pb.status && pb.status >= 400 && pb.status < 500) {
    return NextResponse.json(
      {
        error: pb.message || fallbackMessage,
        details: pb.data || undefined,
      },
      { status: pb.status },
    );
  }

  // Unexpected / network / 5xx errors — don't leak internals
  const message = err instanceof Error ? err.message : fallbackMessage;
  return NextResponse.json({ error: message }, { status: 500 });
}

// ── Deprecated aliases (backward compat) ──────────────

/** @deprecated Use `logError` instead */
export function logApiError(context: { route: string; step?: string; userId?: string; requestBody?: unknown }, err: unknown): void {
  logError({ source: `api:${context.route}`, fn: context.step || "handler", userId: context.userId, requestBody: context.requestBody }, err);
}

/** @deprecated Use `apiErrorResponse` instead */
export function apiError(err: unknown, fallbackMessage: string): NextResponse {
  return apiErrorResponse(err, fallbackMessage);
}
