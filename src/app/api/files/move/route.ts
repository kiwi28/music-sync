import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { moveFileSchema } from "@/lib/validators";
import { movePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";

/**
 * POST /api/files/move
 *
 * Moves or renames a file/folder.
 * Body: { from: string, to: string }
 */
export async function POST(request: NextRequest) {
  try {
    // ── Auth check ──
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // ── Parse body ──
    const body = await request.json();
    const parsed = moveFileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    await movePath(parsed.data.from, parsed.data.to);

    return NextResponse.json({ success: true });
  } catch (err) {
    logApiError({ route: "files/move", step: "POST" }, err);
    return apiErrorResponse(err, "Failed to move");
  }
}
