import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { createFolderSchema } from "@/lib/validators";
import { createFolder, validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import { join } from "node:path";

/**
 * POST /api/files/folder
 *
 * Creates a new directory under the music root.
 * Body: { path: string (parent), name: string (folder name) }
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
    const parsed = createFolderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { path: parentPath, name } = parsed.data;

    // Build the full path and validate
    const fullPath = join(parentPath, name);
    const safePath = validatePath(fullPath);
    if (!safePath) {
      return NextResponse.json(
        { error: "Path is outside the music directory" },
        { status: 400 },
      );
    }

    await createFolder(safePath);

    return NextResponse.json({ success: true, path: fullPath });
  } catch (err) {
    logApiError({ route: "files/folder", step: "POST" }, err);
    return apiErrorResponse(err, "Failed to create folder");
  }
}
