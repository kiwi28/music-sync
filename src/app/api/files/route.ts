import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { deleteFileSchema } from "@/lib/validators";
import { deletePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";

/**
 * DELETE /api/files
 *
 * Deletes a file or folder (recursively) under the music root.
 * Body: { path: string }
 */
export async function DELETE(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // ── Parse body ──
    const body = await request.json();
    const parsed = deleteFileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await deletePath(parsed.data.path);

    return NextResponse.json({ success: true });
  } catch (err) {
    logApiError({ route: "files", step: "DELETE" }, err);
    return apiErrorResponse(err, "Failed to delete");
  }
}
