import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "jobs-list";

/**
 * GET /api/jobs
 *
 * Lists sync jobs for the current user. Supports:
 * - status: filter by "pending" | "running" | "completed" | "failed"
 * - playlistId: filter by playlist
 * - page / perPage: pagination (default 1 / 20)
 *
 * Jobs are returned with expanded playlist so names are available.
 * Sorted by created descending (client-side due to PB 0.28.x bug).
 */
export async function GET(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // ── Parse query params ──
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const playlistId = searchParams.get("playlistId");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPage = Math.min(
      50,
      Math.max(1, parseInt(searchParams.get("perPage") || "20", 10)),
    );

    // ── Build filter ──
    const filters = [`user = "${userId}"`];
    if (
      status &&
      ["pending", "running", "completed", "failed"].includes(status)
    ) {
      filters.push(`status = "${status}"`);
    }
    if (playlistId) {
      filters.push(`playlist = "${playlistId}"`);
    }

    // NOTE: PB 0.28.x returns 400 if sort references `created` on sync_jobs.
    // We sort client-side instead.
    const records = await pb.collection("sync_jobs").getList(page, perPage, {
      filter: filters.join(" && "),
      expand: "playlist",
    });

    // Client-side sort by created descending (PB 0.28.x workaround)
    const sorted = [...records.items].sort(
      (a, b) =>
        new Date(b.created).getTime() - new Date(a.created).getTime(),
    );

    return NextResponse.json({
      items: sorted,
      page: records.page,
      perPage: records.perPage,
      totalItems: records.totalItems,
      totalPages: records.totalPages,
    });
  } catch (err) {
    logApiError({ route: ROUTE, step: "list" }, err);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 },
    );
  }
}
