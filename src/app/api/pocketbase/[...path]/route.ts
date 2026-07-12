import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError, apiError } from "@/lib/api-errors";

const ROUTE = "pocketbase/proxy";

/**
 * Proxy route for PocketBase operations that require server-side validation.
 * Only allows operations the authenticated user is authorized to perform.
 *
 * Supported operations:
 * - GET /api/pocketbase/collections/<name>/records — list records (filtered to user's own)
 * - POST /api/pocketbase/collections/<name>/records — create record (user forced)
 * - PATCH /api/pocketbase/collections/<name>/records/<id> — update record (ownership check)
 * - DELETE /api/pocketbase/collections/<name>/records/<id> — delete record (ownership check)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleProxy(request, "GET", path);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleProxy(request, "POST", path);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleProxy(request, "PATCH", path);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  return handleProxy(request, "DELETE", path);
}

async function handleProxy(
  request: NextRequest,
  method: string,
  path: string[]
): Promise<NextResponse> {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // Parse the path: collections/<name>/records[/<id>]
    if (path[0] !== "collections" || !path[1]) {
      return NextResponse.json(
        { error: "Invalid path. Use /api/pocketbase/collections/<name>/records[/<id>]" },
        { status: 400 }
      );
    }

    const collectionName = path[1];
    const isRecords = path[2] === "records";
    const recordId = path[3] || null;

    if (!isRecords) {
      return NextResponse.json({ error: "Only records endpoints are proxied" }, { status: 400 });
    }

    // Whitelist: only allow operations on these collections
    const ALLOWED_COLLECTIONS = [
      "playlists",
      "tracks",
      "playlist_tracks",
      "sync_jobs",
      "user_connections",
    ];

    if (!ALLOWED_COLLECTIONS.includes(collectionName)) {
      return NextResponse.json(
        { error: `Collection "${collectionName}" is not accessible via proxy` },
        { status: 403 }
      );
    }

    const basePath = `collections/${collectionName}/records`;
    const url = recordId ? `${basePath}/${recordId}` : basePath;
    const searchParams = request.nextUrl.searchParams;

    switch (method) {
      case "GET": {
        // Build filter query — force user-scoped access
        const filters: string[] = [];
        if (collectionName === "user_connections") {
          filters.push(`user = "${userId}"`);
        } else if (["playlists", "sync_jobs"].includes(collectionName)) {
          filters.push(`user = "${userId}"`);
        }

        let queryParams = searchParams.toString();
        if (filters.length > 0) {
          const existingFilter = searchParams.get("filter");
          const combinedFilter = existingFilter
            ? `(${existingFilter}) && ${filters.join(" && ")}`
            : filters.join(" && ");
          queryParams = queryParams
            ? queryParams.replace(
                `filter=${encodeURIComponent(existingFilter || "")}`,
                `filter=${encodeURIComponent(combinedFilter)}`
              )
            : `filter=${encodeURIComponent(combinedFilter)}`;
        }

        const result = await pb.send(
          `${pb.baseUrl}/api/${url}${queryParams ? `?${queryParams}` : ""}`,
          { method: "GET" }
        );
        return NextResponse.json(result);
      }

      case "POST": {
        const body = await request.json();

        // Force user ownership on created records
        if (["playlists", "sync_jobs", "user_connections"].includes(collectionName)) {
          body.user = userId;
        }

        const result = await pb.collection(collectionName).create(body);
        return NextResponse.json(result);
      }

      case "PATCH": {
        if (!recordId) {
          return NextResponse.json({ error: "Record ID required for PATCH" }, { status: 400 });
        }

        // Verify ownership
        const record = await pb.collection(collectionName).getOne(recordId);
        if (record.user && record.user !== userId) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }

        const body = await request.json();
        // Prevent user field tampering
        delete body.user;

        const result = await pb.collection(collectionName).update(recordId, body);
        return NextResponse.json(result);
      }

      case "DELETE": {
        if (!recordId) {
          return NextResponse.json({ error: "Record ID required for DELETE" }, { status: 400 });
        }

        // Verify ownership
        const record = await pb.collection(collectionName).getOne(recordId);
        if (record.user && record.user !== userId) {
          return NextResponse.json({ error: "Not authorized" }, { status: 403 });
        }

        await pb.collection(collectionName).delete(recordId);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
    }
  } catch (err) {
    logApiError(
      { route: ROUTE, step: `${method} ${path.join("/")}`, userId: "via-session" },
      err,
    );
    return apiError(err, "Proxy error");
  }
}
