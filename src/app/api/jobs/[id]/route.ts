import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "jobs-detail";

const VALID_ACTIONS = ["cancel", "reset"] as const;
type JobAction = (typeof VALID_ACTIONS)[number];

/**
 * GET /api/jobs/[id]
 *
 * Returns a single job with expanded playlist.
 * Returns 404 if not found or not owned by the current user.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const userId = pb.authStore.record.id;

    let job;
    try {
      job = await pb.collection("sync_jobs").getOne(id, {
        expand: "playlist",
      });
    } catch {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.user !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    return NextResponse.json(job);
  } catch (err) {
    logApiError({ route: ROUTE, step: "get" }, err);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/jobs/[id]
 *
 * Body: { action: "cancel" | "reset" }
 *
 * - cancel: Sets status to "failed" with "Cancelled by user".
 *   Only allowed for "pending" or "running" jobs.
 * - reset: Sets status back to "pending", clearing error/timestamps.
 *   Only allowed for "failed" jobs.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const userId = pb.authStore.record.id;

    let job;
    try {
      job = await pb.collection("sync_jobs").getOne(id);
    } catch {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.user !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const body = await request.json();
    const action: JobAction = body.action;

    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        {
          error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}`,
        },
        { status: 400 },
      );
    }

    if (action === "cancel") {
      if (job.status === "completed" || job.status === "failed") {
        return NextResponse.json(
          { error: `Cannot cancel a job in "${job.status}" status` },
          { status: 409 },
        );
      }

      const updated = await pb.collection("sync_jobs").update(id, {
        status: "failed",
        error: "Cancelled by user",
        completed_at: new Date().toISOString(),
        log: `${job.log || ""}\nCancelled by user`,
      });

      return NextResponse.json(updated);
    }

    // action === "reset"
    if (job.status !== "failed") {
      return NextResponse.json(
        {
          error: `Can only reset jobs in "failed" status, not "${job.status}"`,
        },
        { status: 409 },
      );
    }

    const updated = await pb.collection("sync_jobs").update(id, {
      status: "pending",
      error: null,
      started_at: null,
      completed_at: null,
      log: `${job.log || ""}\nReset — re-queued for retry`,
    });

    return NextResponse.json(updated);
  } catch (err) {
    logApiError({ route: ROUTE, step: "patch" }, err);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/jobs/[id]
 *
 * Deletes a job record. Only allowed for terminal states
 * ("completed" or "failed"). Active jobs must be cancelled first.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const userId = pb.authStore.record.id;

    let job;
    try {
      job = await pb.collection("sync_jobs").getOne(id);
    } catch {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.user !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (job.status === "pending" || job.status === "running") {
      return NextResponse.json(
        {
          error: `Cannot delete a job in "${job.status}" status. Cancel it first.`,
        },
        { status: 409 },
      );
    }

    await pb.collection("sync_jobs").delete(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    logApiError({ route: ROUTE, step: "delete" }, err);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 },
    );
  }
}
