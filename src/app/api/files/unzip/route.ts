import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { unzipFileSchema } from "@/lib/validators";
import { validatePath } from "@/lib/files";
import { logApiError, apiErrorResponse } from "@/lib/api-errors";
import AdmZip from "adm-zip";
import { stat } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * POST /api/files/unzip
 *
 * Extracts a ZIP file in-place (same directory). Overwrites existing files.
 * The path must point to a .zip file within the music directory.
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
    const parsed = unzipFileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // ── Validate path ──
    const safePath = validatePath(parsed.data.path);
    if (!safePath) {
      return NextResponse.json(
        { error: "Path is outside the music directory" },
        { status: 403 },
      );
    }

    // ── Ensure path exists and is a .zip file ──
    let fileStat;
    try {
      fileStat = await stat(safePath);
    } catch {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    if (fileStat.isDirectory()) {
      return NextResponse.json(
        { error: "Path is a directory, not a ZIP file" },
        { status: 400 },
      );
    }

    if (!safePath.toLowerCase().endsWith(".zip")) {
      return NextResponse.json(
        { error: "File is not a ZIP archive" },
        { status: 400 },
      );
    }

    // ── Extract ──
    const zip = new AdmZip(safePath);
    const targetDir = dirname(safePath);
    const entries = zip.getEntries();
    zip.extractAllTo(targetDir, true);

    return NextResponse.json({
      success: true,
      extractedCount: entries.length,
    });
  } catch (err) {
    logApiError({ route: "files/unzip", step: "POST" }, err);
    return apiErrorResponse(err, "Extraction failed");
  }
}
