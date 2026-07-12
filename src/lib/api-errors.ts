import { NextResponse } from "next/server";

/**
 * Structured error logging for API routes.
 *
 * PocketBase's JS SDK throws ClientResponseError with:
 *   - message: generic ("Failed to create record.")
 *   - status:  HTTP status (400, 403, 404, etc.)
 *   - data:    field-level validation errors (the useful part)
 *   - url:     the PocketBase API URL that was called
 *
 * This utility extracts and logs all of that, then returns a
 * well-formed NextResponse so the client sees actionable errors.
 */

interface PocketBaseErrorLike {
  message?: string;
  status?: number;
  code?: number;
  data?: Record<string, { code: string; message: string }>;
  url?: string;
  originalError?: unknown;
}

interface LogContext {
  route: string;
  step?: string;
  userId?: string;
  requestBody?: unknown;
}

/** Extract PocketBase error details from any caught error */
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

/**
 * Log a caught error with full context (route, step, user, PB details).
 * Call this in every catch block across API routes.
 */
export function logApiError(context: LogContext, err: unknown): void {
  const pb = extractPbError(err);
  const parts: string[] = [`[${context.route}]`];
  if (context.step) parts.push(`step=${context.step}`);

  const label = parts.join(" ");

  console.error(`${label} — ${pb.message || (err instanceof Error ? err.message : String(err))}`);

  if (context.userId) {
    console.error(`${label}   user: ${context.userId}`);
  }

  if (pb.status) {
    console.error(`${label}   status: ${pb.status}  pb_url: ${pb.url || "n/a"}`);
  }

  if (pb.data) {
    console.error(`${label}   validation errors:`);
    for (const [field, detail] of Object.entries(pb.data)) {
      console.error(`${label}     ${field}: ${detail.message} (${detail.code})`);
    }
  }

  if (context.requestBody) {
    console.error(`${label}   request body:`, JSON.stringify(context.requestBody, null, 2));
  }

  // Log full raw error for unexpected errors
  if (!pb.status && !pb.data) {
    console.error(`${label}   raw error:`, err);
  }
}

/**
 * Build a NextResponse from a caught error.
 * Returns 400-level statuses from PocketBase as-is (they're client errors).
 * Returns 500 for truly unexpected errors.
 *
 * Usage:
 *   try { ... } catch (err) {
 *     logApiError({ route: "spotify/import" }, err);
 *     return apiError(err, "Failed to import playlists");
 *   }
 */
export function apiError(err: unknown, fallbackMessage: string): NextResponse {
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
