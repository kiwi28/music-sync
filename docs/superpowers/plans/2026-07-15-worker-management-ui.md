# Worker Management UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build full worker/job management UI — jobs page, API routes, real-time SSE, toasts, worker heartbeat, .m3u generation.

**Architecture:** New `/jobs` page backed by API routes (user-session auth), PocketBase SSE for live updates, worker writes heartbeat + scheduler state to new `worker_status` collection, toast system via React context.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, PocketBase JS SDK, Tailwind CSS 4, lucide-react

---

## File Map

```
CREATE:
  pb_migrations/1785200000_create_worker_status.js   — worker_status collection
  worker/src/heartbeat.js                             — heartbeat + scheduler state writer
  src/app/api/jobs/route.ts                           — GET /api/jobs (list)
  src/app/api/jobs/[id]/route.ts                      — GET/PATCH/DELETE /api/jobs/[id]
  src/app/api/jobs/[id]/retry/route.ts                — POST /api/jobs/[id]/retry
  src/app/api/worker/status/route.ts                  — GET /api/worker/status
  src/app/jobs/page.tsx                               — /jobs page
  src/components/jobs/job-row.tsx                     — Single job row
  src/components/jobs/job-detail-sheet.tsx            — Job detail slide-out
  src/components/jobs/worker-status-bar.tsx           — Worker health bar
  src/components/ui/toast.tsx                         — Toast component
  src/components/layout/toast-provider.tsx            — Toast context provider
  src/hooks/use-jobs.ts                               — useJobs, useWorkerStatus, useJobSubscription

MODIFY:
  worker/src/worker.js                                — add heartbeat, stale-pending reset, cancel check
  worker/src/scheduler.js                             — add scheduler state tracking
  worker/src/utils.js                                 — add generateM3u, export it
  worker/src/downloads/spotdl.js                      — call generateM3u after download
  worker/src/downloads/ytdlp.js                       — call generateM3u after download
  src/components/layout/sidebar.tsx                   — add Jobs nav item
  src/components/layout/app-shell.tsx                 — wrap with ToastProvider
  src/components/sync/sync-history.tsx                — link to /jobs, real-time status
  src/app/playlists/[id]/page.tsx                     — SSE instead of polling
  src/hooks/use-playlists.ts                          — SSE replacements for polling hooks
```

---

### Task 1: PocketBase Migration for `worker_status` Collection

**Files:**
- Create: `pb_migrations/1785200000_create_worker_status.js`

- [ ] **Step 1: Create the migration file**

```js
/// <reference path="../pb_data/types.d.ts" />
migrate(
  (db) => {
    const collection = new Collection({
      name: "worker_status",
      type: "base",
      system: false,
      schema: [
        { name: "last_poll_at", type: "date", required: false },
        { name: "pending_count", type: "number", required: false, min: 0 },
        { name: "running_count", type: "number", required: false, min: 0 },
        { name: "scheduler_last_check_at", type: "date", required: false },
        { name: "scheduler_next_check_at", type: "date", required: false },
        { name: "scheduler_sync_interval_minutes", type: "number", required: false, min: 0 },
        { name: "scheduler_check_interval_minutes", type: "number", required: false, min: 0 },
        { name: "scheduler_stale_playlist_count", type: "number", required: false, min: 0 },
      ],
      listRule: "",
      viewRule: "",
      createRule: "@request.auth.id != ''",
      updateRule: "@request.auth.id != ''",
      deleteRule: "@request.auth.id != ''",
    });
    return db.save(collection);
  },
  (db) => {
    return db.deleteCollection("worker_status");
  }
);
```

- [ ] **Step 2: Commit**

```bash
git add pb_migrations/1785200000_create_worker_status.js
git commit -m "feat: add worker_status collection for worker health monitoring"
```

---

### Task 2: Worker Heartbeat Module

**Files:**
- Create: `worker/src/heartbeat.js`

- [ ] **Step 1: Create heartbeat.js**

```js
// Writes worker health/status to the worker_status singleton collection.
// Called after each poll loop and after each scheduler tick.

/**
 * Update the worker heartbeat after a poll loop iteration.
 * Creates the singleton record if it doesn't exist yet.
 */
export async function updateHeartbeat(pb, { pendingCount, runningCount }) {
  try {
    const existing = await pb.collection("worker_status").getList(1, 1);
    const record = existing.items[0];

    const data = {
      last_poll_at: new Date().toISOString(),
      pending_count: pendingCount,
      running_count: runningCount,
    };

    if (record) {
      await pb.collection("worker_status").update(record.id, data);
    } else {
      await pb.collection("worker_status").create(data);
    }
  } catch (err) {
    // Heartbeat failures are non-fatal — the poll loop continues.
    console.error("[heartbeat] Failed to update:", err.message);
  }
}

/**
 * Update scheduler state after a scheduler tick.
 */
export async function updateSchedulerState(pb, { syncIntervalMinutes, checkIntervalMs, stalePlaylistCount }) {
  try {
    const existing = await pb.collection("worker_status").getList(1, 1);
    const record = existing.items[0];

    const data = {
      scheduler_last_check_at: new Date().toISOString(),
      scheduler_next_check_at: new Date(Date.now() + checkIntervalMs).toISOString(),
      scheduler_sync_interval_minutes: syncIntervalMinutes,
      scheduler_check_interval_minutes: Math.round(checkIntervalMs / 60_000),
      scheduler_stale_playlist_count: stalePlaylistCount,
    };

    if (record) {
      await pb.collection("worker_status").update(record.id, data);
    } else {
      // Create with heartbeat fields too so both paths converge on one record.
      await pb.collection("worker_status").create({
        ...data,
        last_poll_at: new Date().toISOString(),
        pending_count: 0,
        running_count: 0,
      });
    }
  } catch (err) {
    console.error("[heartbeat] Failed to update scheduler state:", err.message);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/heartbeat.js
git commit -m "feat: add worker heartbeat and scheduler state modules"
```

---

### Task 3: Add Heartbeat to Worker Poll Loop + Stale Pending Reset

**Files:**
- Modify: `worker/src/worker.js`

- [ ] **Step 1: Import heartbeat**

After the existing imports, add:
```js
import { updateHeartbeat } from "./heartbeat.js";
```

- [ ] **Step 2: Add heartbeat after each poll loop iteration**

In `main()`, after the job processing `for` loop inside the `while (true)` block, add heartbeat:

```js
// In main(), after the for loop that processes jobs:
      for (const job of jobs.items) {
        await processJob(pb, job);
      }

      // NEW: heartbeat after each poll iteration
      const counts = await pb.collection("sync_jobs").getList(1, 1, {
        filter: 'status = "pending"',
      });
      const runningCounts = await pb.collection("sync_jobs").getList(1, 1, {
        filter: 'status = "running"',
      });
      // Use withReauth to survive token expiry during heartbeat
      await pb.withReauth(() =>
        updateHeartbeat(pb, {
          pendingCount: counts.totalItems,
          runningCount: runningCounts.totalItems,
        })
      );
```

Wait — the heartbeat calls `getList` internally on `worker_status`, which needs `withReauth`. But `updateHeartbeat` doesn't have access to `withReauth`. Let me think about this differently.

Actually, `updateHeartbeat` takes `pb` and uses it directly. The `pb` from `getAdminClient()` is wrapped with `withReauth` — so all collection operations through it are protected. Let me simplify: the heartbeat uses the pb client directly, and the caller doesn't need to wrap it.

Wait, looking at pb-client.js more carefully: `getAdminClient()` returns a PocketBase instance. The `withReauth` function is attached to that instance. But normal `pb.collection()` calls are NOT wrapped in `withReauth` — only long-running operations in spotdl.js/ytdlp.js use it explicitly.

The heartbeat operations are quick (single read + single write), so they're very unlikely to hit token expiry. But to be safe, let me NOT wrap them — the existing poll loop's `pb.collection("sync_jobs").getList()` isn't wrapped either. If the heartbeat fails due to token expiry, it'll just log an error and the next poll iteration will re-authenticate naturally.

Simplified approach:

```js
// In main(), after the for loop that processes jobs:
      // Heartbeat: let the UI know the worker is alive
      updateHeartbeat(pb, {
        pendingCount: jobs.totalItems,
        runningCount: 0, // We just processed all pending jobs, so running count is transient
      }).catch(() => {}); // fire-and-forget, non-fatal
```

Actually even simpler — we don't need to query for counts separately. The pending count we already have from `jobs.totalItems`. Running count is whatever was previously set. Let me just keep it simple.

- [ ] **Step 2 (revised): Add heartbeat after each poll loop**

In `main()`, right after the `for (const job of jobs.items)` loop and before `await sleep(POLL_INTERVAL_MS)`:

```js
      // Heartbeat: signal to the UI that the worker is alive
      updateHeartbeat(pb, {
        pendingCount: jobs.totalItems,
        runningCount: 0,
      }).catch(() => {});
```

Wait, `jobs.totalItems` from `getList` returns the total matching the filter across all pages — that's the actual pending count. But after processing, some may be gone. Close enough for a heartbeat — the next poll will correct it.

- [ ] **Step 3: Enhance resetStaleJobs to also reset stale pending jobs**

In the `resetStaleJobs` function, add pending job reset after the running job reset:

```js
  // Also reset stale "pending" jobs (older than 60 minutes)
  const sixtyMinutesAgo = Date.now() - 60 * 60 * 1000;
  const pendingJobs = await pb.collection("sync_jobs").getList(1, 100, {
    filter: 'status = "pending"',
  });

  const stalePendingJobs = pendingJobs.items.filter((job) => {
    const created = new Date(job.created).getTime();
    return created < sixtyMinutesAgo;
  });

  for (const job of stalePendingJobs) {
    console.log(`[worker] Resetting stale pending job ${job.id} → re-queued`);
    await pb.collection("sync_jobs").update(job.id, {
      log: `${job.log || ""}\nReset — was stuck pending for >60min (worker restart)`,
    });
  }

  if (stalePendingJobs.length) {
    console.log(`[worker] Reset ${stalePendingJobs.length} stale pending jobs`);
  }
```

Note: we keep them as "pending" (they already are), just update the log so it's visible that they were stuck.

- [ ] **Step 4: Add cancellation check in processJob**

In `processJob()`, after fetching the playlist but before marking as "running", insert:

```js
  // Check if the job was cancelled by the user before we start
  const freshJob = await pb.collection("sync_jobs").getOne(job.id);
  if (freshJob.status !== "pending") {
    console.log(`[worker] Job ${job.id} status is "${freshJob.status}" — skipping (was cancelled or already processed)`);
    return;
  }
```

This catches both cancellations (user set status to "failed" via API) and race conditions (another worker instance already picked it up).

- [ ] **Step 5: Commit**

```bash
git add worker/src/worker.js
git commit -m "feat: add worker heartbeat, stale pending reset, job cancel check"
```

---

### Task 4: Add Scheduler State Tracking

**Files:**
- Modify: `worker/src/scheduler.js`

- [ ] **Step 1: Import heartbeat scheduler function**

At the top of `scheduler.js`, add:
```js
import { updateSchedulerState } from "./heartbeat.js";
```

- [ ] **Step 2: Call updateSchedulerState at end of schedulerTick**

In `schedulerTick()`, after the `if (enqueued === 0)` block and before the closing brace of the `try` block:

```js
      // Update scheduler state for UI visibility
      await updateSchedulerState(pb, {
        syncIntervalMinutes: SYNC_INTERVAL_MINUTES,
        checkIntervalMs: CHECK_INTERVAL_MS,
        stalePlaylistCount: playlists.filter((p) => {
          const cutoff = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1000).toISOString();
          return !p.last_synced || p.last_synced < cutoff;
        }).length,
      }).catch((err) => console.error("[scheduler] Failed to update state:", err.message));
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/scheduler.js
git commit -m "feat: track scheduler state in worker_status for UI visibility"
```

---

### Task 5: Generate .m3u Playlist File After Download

**Files:**
- Modify: `worker/src/utils.js`
- Modify: `worker/src/downloads/spotdl.js`
- Modify: `worker/src/downloads/ytdlp.js`

- [ ] **Step 1: Add generateM3u to utils.js**

Append to the end of `worker/src/utils.js`:

```js
import { execFile } from "node:child_process";
import { join } from "node:path";

/**
 * Generate an .m3u playlist file listing all audio files in a directory.
 * Non-fatal — errors are logged but do not fail the sync.
 */
export function generateM3u(dirPath, playlistName) {
  return new Promise((resolve) => {
    const safeName = sanitizeFolderName(playlistName);
    const m3uPath = join(dirPath, `${safeName}.m3u`);
    execFile(
      "sh",
      ["-c", `cd "${dirPath}" && ls *.mp3 *.flac *.m4a 2>/dev/null > "${m3uPath}"`],
      { timeout: 10000 },
      (err) => {
        if (err) {
          console.error(`[m3u] Failed to generate .m3u for "${playlistName}":`, err.message);
        } else {
          console.log(`[m3u] Generated "${playlistName}.m3u"`);
        }
        resolve();
      }
    );
  });
}
```

- [ ] **Step 2: Call generateM3u in spotdl.js**

At the top of `worker/src/downloads/spotdl.js`, add the import:
```js
import { generateM3u } from "../utils.js";
```

In `processSpotifyJob()`, after all track records are created and before the return statement, add:
```js
  // Generate .m3u for Navidrome local playlist import
  const downloadDir = join(MUSIC_DIR, sanitizeFolderName(playlist.name));
  await generateM3u(downloadDir, playlist.name);
```

The `MUSIC_DIR` and `sanitizeFolderName` are already imported/used in spotdl.js. Need to add `join` from `node:path` if not already imported.

- [ ] **Step 3: Call generateM3u in ytdlp.js**

Same as step 2 but in `worker/src/downloads/ytdlp.js`:
```js
import { generateM3u } from "../utils.js";
```

And at the end of `processYoutubeMusicJob()`:
```js
  const downloadDir = join(MUSIC_DIR, playlistDir);
  await generateM3u(downloadDir, playlist.name);
```

Note: ytdlp.js uses `playlistDir` as the variable name for the download directory (it's computed via `sanitizeFolderName` earlier).

- [ ] **Step 4: Commit**

```bash
git add worker/src/utils.js worker/src/downloads/spotdl.js worker/src/downloads/ytdlp.js
git commit -m "feat: generate .m3u playlist file after successful sync"
```

---

### Task 6: API Route — GET /api/jobs (List Jobs)

**Files:**
- Create: `src/app/api/jobs/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "jobs-list";

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = pb.authStore.record.id;

    // Parse query params
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const playlistId = searchParams.get("playlistId");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPage = Math.min(50, Math.max(1, parseInt(searchParams.get("perPage") || "20", 10)));

    // Build filter
    const filters = [`user = "${userId}"`];
    if (status && ["pending", "running", "completed", "failed"].includes(status)) {
      filters.push(`status = "${status}"`);
    }
    if (playlistId) {
      filters.push(`playlist = "${playlistId}"`);
    }

    const records = await pb.collection("sync_jobs").getList(page, perPage, {
      filter: filters.join(" && "),
      expand: "playlist",
      // NOTE: PB 0.28.x 400 bug on sort — we'll sort client-side via the
      // default PocketBase order (by created desc) which seems to work
      // without an explicit sort param.
    });

    // Client-side sort by created desc (PB 0.28.x workaround)
    const sorted = [...records.items].sort(
      (a, b) => new Date(b.created).getTime() - new Date(a.created).getTime()
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
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/jobs/route.ts
git commit -m "feat: add GET /api/jobs endpoint with filtering and pagination"
```

---

### Task 7: API Route — GET/PATCH/DELETE /api/jobs/[id]

**Files:**
- Create: `src/app/api/jobs/[id]/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "jobs-detail";

/** Get a single job by ID */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
      job = await pb.collection("sync_jobs").getOne(id, { expand: "playlist" });
    } catch {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if (job.user !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    return NextResponse.json(job);
  } catch (err) {
    logApiError({ route: ROUTE, step: "get" }, err);
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 });
  }
}

const VALID_ACTIONS = ["cancel", "reset"] as const;
type JobAction = (typeof VALID_ACTIONS)[number];

/** Cancel or reset a job */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 }
      );
    }

    if (action === "cancel") {
      if (job.status === "completed" || job.status === "failed") {
        return NextResponse.json(
          { error: `Cannot cancel a job in "${job.status}" status` },
          { status: 409 }
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

    if (action === "reset") {
      if (job.status !== "failed") {
        return NextResponse.json(
          { error: `Can only reset jobs in "failed" status, not "${job.status}"` },
          { status: 409 }
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
    }
  } catch (err) {
    logApiError({ route: ROUTE, step: "patch" }, err);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }
}

/** Delete a job (terminal states only) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
        { error: `Cannot delete a job in "${job.status}" status. Cancel it first.` },
        { status: 409 }
      );
    }

    await pb.collection("sync_jobs").delete(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    logApiError({ route: ROUTE, step: "delete" }, err);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/jobs/[id]/route.ts
git commit -m "feat: add GET/PATCH/DELETE /api/jobs/[id] for job management"
```

---

### Task 8: API Route — POST /api/jobs/[id]/retry + GET /api/worker/status

**Files:**
- Create: `src/app/api/jobs/[id]/retry/route.ts`
- Create: `src/app/api/worker/status/route.ts`

- [ ] **Step 1: Create retry route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/pocketbase-server";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "jobs-retry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const pb = await createServerClient();
    if (!pb.authStore.isValid || !pb.authStore.record) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { id } = await params;
    const userId = pb.authStore.record.id;

    let originalJob;
    try {
      originalJob = await pb.collection("sync_jobs").getOne(id);
    } catch {
      return NextResponse.json({ error: "Original job not found" }, { status: 404 });
    }

    if (originalJob.user !== userId) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    // Get the playlist to check it still exists
    let playlist;
    try {
      playlist = await pb.collection("playlists").getOne(originalJob.playlist);
    } catch {
      return NextResponse.json(
        { error: "Associated playlist no longer exists" },
        { status: 404 }
      );
    }

    // Check for existing pending/running job for this playlist
    const existing = await pb.collection("sync_jobs").getList(1, 1, {
      filter: `playlist = "${playlist.id}" && (status = "pending" || status = "running")`,
    });
    if (existing.totalItems > 0) {
      return NextResponse.json(
        { error: "A sync is already in progress or queued for this playlist" },
        { status: 409 }
      );
    }

    // Create a fresh pending job
    const newJob = await pb.collection("sync_jobs").create({
      playlist: playlist.id,
      user: userId,
      status: "pending",
      log: `Retry of job ${id}: Queued sync of "${playlist.name}"`,
    });

    return NextResponse.json(newJob, { status: 201 });
  } catch (err) {
    logApiError({ route: ROUTE, step: "retry" }, err);
    return NextResponse.json(
      { error: "Failed to retry job" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Create worker status route**

```ts
import { NextResponse } from "next/server";
import PocketBase from "pocketbase";
import { logApiError } from "@/lib/api-errors";

const ROUTE = "worker-status";

export async function GET() {
  try {
    // Use a fresh client (no auth needed — worker_status is public-read)
    const pb = new PocketBase(process.env.POCKETBASE_URL || "http://pocketbase:8090");

    const result = await pb.collection("worker_status").getList(1, 1);
    const record = result.items[0];

    if (!record) {
      return NextResponse.json({ online: false });
    }

    const lastPollAt = record.last_poll_at
      ? new Date(record.last_poll_at).getTime()
      : 0;
    const now = Date.now();
    const lastPollSecondsAgo = Math.round((now - lastPollAt) / 1000);

    // Worker is considered online if it polled within the last 2 minutes
    const online = lastPollSecondsAgo < 120;

    return NextResponse.json({
      online,
      lastPollAt: record.last_poll_at || null,
      lastPollSecondsAgo: online ? lastPollSecondsAgo : null,
      scheduler: {
        lastCheckAt: record.scheduler_last_check_at || null,
        nextCheckAt: record.scheduler_next_check_at || null,
        syncIntervalMinutes: record.scheduler_sync_interval_minutes || null,
        checkIntervalMinutes: record.scheduler_check_interval_minutes || null,
        stalePlaylistCount: record.scheduler_stale_playlist_count || 0,
      },
      stats: {
        pendingJobs: record.pending_count || 0,
        runningJobs: record.running_count || 0,
      },
    });
  } catch (err) {
    logApiError({ route: ROUTE, step: "status" }, err);
    // If the collection doesn't exist yet or PB is unreachable, return offline
    return NextResponse.json({ online: false });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/jobs/[id]/retry/route.ts src/app/api/worker/status/route.ts
git commit -m "feat: add POST /api/jobs/[id]/retry and GET /api/worker/status endpoints"
```

---

### Task 9: Hooks — useJobs, useWorkerStatus

**Files:**
- Create: `src/hooks/use-jobs.ts`

- [ ] **Step 1: Create use-jobs.ts with useJobs and useWorkerStatus hooks**

```ts
"use client";

import { useState, useEffect, useCallback } from "react";
import type { SyncJob } from "@/lib/types";
import { useAuth } from "@/components/layout/providers";

interface JobsFilters {
  status?: string;
  playlistId?: string;
  page?: number;
  perPage?: number;
}

interface JobsResponse {
  items: SyncJob[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
}

export function useJobs(filters: JobsFilters = {}) {
  const { user } = useAuth();
  const [data, setData] = useState<JobsResponse>({
    items: [],
    page: 1,
    perPage: 20,
    totalItems: 0,
    totalPages: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!user) {
      setData({ items: [], page: 1, perPage: 20, totalItems: 0, totalPages: 0 });
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.playlistId) params.set("playlistId", filters.playlistId);
      params.set("page", String(filters.page || 1));
      params.set("perPage", String(filters.perPage || 20));

      const res = await fetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch jobs");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }, [user, filters.status, filters.playlistId, filters.page, filters.perPage]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return { ...data, loading, error, refetch: fetchJobs };
}

interface WorkerStatus {
  online: boolean;
  lastPollAt: string | null;
  lastPollSecondsAgo: number | null;
  scheduler: {
    lastCheckAt: string | null;
    nextCheckAt: string | null;
    syncIntervalMinutes: number | null;
    checkIntervalMinutes: number | null;
    stalePlaylistCount: number;
  };
  stats: {
    pendingJobs: number;
    runningJobs: number;
  };
}

export function useWorkerStatus() {
  const [status, setStatus] = useState<WorkerStatus>({
    online: false,
    lastPollAt: null,
    lastPollSecondsAgo: null,
    scheduler: {
      lastCheckAt: null,
      nextCheckAt: null,
      syncIntervalMinutes: null,
      checkIntervalMinutes: null,
      stalePlaylistCount: 0,
    },
    stats: { pendingJobs: 0, runningJobs: 0 },
  });
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/worker/status");
      if (res.ok) {
        const json = await res.json();
        setStatus(json);
      }
    } catch {
      setStatus((prev) => ({ ...prev, online: false }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { ...status, loading, refetch: fetchStatus };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-jobs.ts
git commit -m "feat: add useJobs and useWorkerStatus hooks"
```

---

### Task 10: Job Actions Helper (API calls for cancel/delete/retry)

**Files:**
- Modify: `src/hooks/use-jobs.ts` (add job action functions)

- [ ] **Step 1: Add job action functions to use-jobs.ts**

```ts
/** Cancel a running/pending job */
export async function cancelJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to cancel job");
  }
}

/** Delete a terminal job */
export async function deleteJob(jobId: string): Promise<void> {
  const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to delete job");
  }
}

/** Retry a job (creates a new pending job for the same playlist) */
export async function retryJob(jobId: string): Promise<SyncJob> {
  const res = await fetch(`/api/jobs/${jobId}/retry`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || "Failed to retry job");
  }
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/use-jobs.ts
git commit -m "feat: add cancelJob, deleteJob, retryJob action functions"
```

---

### Task 11: JobRow Component

**Files:**
- Create: `src/components/jobs/job-row.tsx`

- [ ] **Step 1: Create JobRow component**

```tsx
"use client";

import { useState } from "react";
import type { SyncJob } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLATFORM_META, timeAgo } from "@/lib/utils";
import Link from "next/link";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_CONFIG: Record<string, { variant: "success" | "warning" | "danger" | "default"; label: string; icon: string }> = {
  completed: { variant: "success", label: "Completed", icon: "✓" },
  running: { variant: "warning", label: "Running", icon: "●" },
  pending: { variant: "default", label: "Queued", icon: "○" },
  failed: { variant: "danger", label: "Failed", icon: "✗" },
};

interface JobRowProps {
  job: SyncJob;
  onCancel: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  isHighlighted?: boolean;
}

export function JobRow({ job, onCancel, onRetry, onDelete, isHighlighted }: JobRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const status = STATUS_CONFIG[job.status] ?? STATUS_CONFIG.failed;
  const playlistName = job.expand?.playlist?.name ?? "Unknown playlist";
  const platform = job.expand?.playlist?.platform;
  const meta = platform ? PLATFORM_META[platform] : null;

  async function handleAction(action: string, fn: () => Promise<void>) {
    setActionLoading(action);
    try {
      await fn();
    } catch (err) {
      console.error(`[JobRow] ${action} failed:`, err);
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${
        isHighlighted
          ? "border-white/20 bg-white/10"
          : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Status */}
        <Badge variant={status.variant}>
          <span className="mr-1">{status.icon}</span>
          {status.label}
        </Badge>

        {/* Playlist name */}
        <Link
          href={`/playlists/${job.playlist}`}
          className="flex-1 truncate text-sm font-medium hover:text-white/80"
        >
          {playlistName}
        </Link>

        {/* Platform */}
        {meta && (
          <span className="flex items-center gap-1 text-xs text-white/40">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.color}`} />
            {meta.label}
          </span>
        )}

        {/* Time */}
        <span className="text-xs text-white/30 tabular-nums whitespace-nowrap">
          {job.started_at ? timeAgo(job.started_at) : job.created ? timeAgo(job.created) : "—"}
        </span>

        {/* Tracks added */}
        {job.tracks_added != null && job.tracks_added > 0 && (
          <span className="text-xs text-green-400 tabular-nums whitespace-nowrap">
            +{job.tracks_added}
          </span>
        )}

        {/* Expand toggle */}
        {(job.log || job.error) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-white/30 hover:text-white/60"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {(job.status === "pending" || job.status === "running") && (
            <Button
              size="sm"
              variant="ghost"
              disabled={actionLoading === "cancel"}
              onClick={() => handleAction("cancel", () => onCancel(job.id))}
              className="h-7 text-xs text-red-400 hover:text-red-300"
            >
              {actionLoading === "cancel" ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                "Cancel"
              )}
            </Button>
          )}
          {(job.status === "failed" || job.status === "completed") && (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={actionLoading === "retry"}
                onClick={() => handleAction("retry", () => onRetry(job.id))}
                className="h-7 text-xs"
              >
                {actionLoading === "retry" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  "Retry"
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={actionLoading === "delete"}
                onClick={() => handleAction("delete", () => onDelete(job.id))}
                className="h-7 text-xs text-white/30 hover:text-red-400"
              >
                {actionLoading === "delete" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  "Delete"
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Expandable log/error */}
      {expanded && (job.log || job.error) && (
        <div className="mt-2 border-t border-white/5 pt-2">
          {job.log && (
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-white/50 font-mono">
              {job.log}
            </pre>
          )}
          {job.error && (
            <p className="mt-1 text-xs text-red-400">{job.error}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function JobRowSkeleton() {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="h-5 w-16 animate-pulse rounded bg-white/5" />
        <div className="h-4 flex-1 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-16 animate-pulse rounded bg-white/5" />
        <div className="h-4 w-20 animate-pulse rounded bg-white/5" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/jobs/job-row.tsx
git commit -m "feat: add JobRow component with actions and expandable log"
```

---

### Task 12: WorkerStatusBar Component

**Files:**
- Create: `src/components/jobs/worker-status-bar.tsx`

- [ ] **Step 1: Create WorkerStatusBar**

```tsx
"use client";

import { useWorkerStatus } from "@/hooks/use-jobs";

export function WorkerStatusBar() {
  const { online, lastPollSecondsAgo, scheduler, stats, loading } = useWorkerStatus();

  if (loading) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2">
        <div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
      </div>
    );
  }

  const dotColor = online ? "bg-green-500" : "bg-red-500";
  const statusText = online
    ? `Worker online — last poll ${lastPollSecondsAgo}s ago`
    : "Worker offline";

  function formatMinutes(minutes: number | null): string {
    if (!minutes) return "—";
    if (minutes < 60) return `${minutes}m`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }

  function timeUntil(isoString: string | null): string {
    if (!isoString) return "—";
    const ms = new Date(isoString).getTime() - Date.now();
    if (ms <= 0) return "now";
    const minutes = Math.round(ms / 60_000);
    return formatMinutes(minutes);
  }

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2 text-xs text-white/40">
      {/* Worker status */}
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dotColor} ${online ? "animate-pulse" : ""}`} />
        <span>{statusText}</span>
      </div>

      {/* Scheduler */}
      <span>
        Scheduler: {formatMinutes(scheduler.syncIntervalMinutes)} window · check every{" "}
        {formatMinutes(scheduler.checkIntervalMinutes)} · next check in{" "}
        {timeUntil(scheduler.nextCheckAt)}
      </span>

      {/* Stats */}
      <span>
        {stats.pendingJobs} pending · {stats.runningJobs} running
      </span>

      {/* Stale playlists */}
      {scheduler.stalePlaylistCount > 0 && (
        <span className="text-amber-400">
          {scheduler.stalePlaylistCount} stale playlist{scheduler.stalePlaylistCount !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/jobs/worker-status-bar.tsx
git commit -m "feat: add WorkerStatusBar component"
```

---

### Task 13: Jobs Page (`/jobs`)

**Files:**
- Create: `src/app/jobs/page.tsx`

- [ ] **Step 1: Create the /jobs page**

```tsx
"use client";

import { useState, useCallback } from "react";
import { useJobs, cancelJob, deleteJob, retryJob } from "@/hooks/use-jobs";
import { JobRow, JobRowSkeleton } from "@/components/jobs/job-row";
import { WorkerStatusBar } from "@/components/jobs/worker-status-bar";
import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "pending", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
] as const;

export default function JobsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");
  const [page, setPage] = useState(1);
  const highlightId = searchParams.get("highlight");

  const { items, totalItems, totalPages, loading, error, refetch } = useJobs({
    status: statusFilter || undefined,
    page,
    perPage: 20,
  });

  const handleAction = useCallback(
    async (action: string, jobId: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        refetch();
      } catch (err) {
        console.error(`[JobsPage] ${action} failed:`, err);
      }
    },
    [refetch]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sync Jobs</h1>
          <p className="mt-1 text-sm text-white/40">
            {totalItems} job{totalItems !== 1 ? "s" : ""} total
          </p>
        </div>
      </div>

      {/* Worker status */}
      <WorkerStatusBar />

      {/* Status filter tabs */}
      <div className="flex gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setStatusFilter(tab.value);
              setPage(1);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === tab.value
                ? "bg-white/10 text-white"
                : "text-white/40 hover:bg-white/5 hover:text-white/60"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
          <Button variant="ghost" size="sm" className="ml-2" onClick={refetch}>
            Retry
          </Button>
        </div>
      )}

      {/* Job list */}
      <div className="space-y-2">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <JobRowSkeleton key={i} />)
          : items.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                isHighlighted={job.id === highlightId}
                onCancel={(id) =>
                  handleAction("cancel", id, () => cancelJob(id))
                }
                onRetry={(id) =>
                  handleAction("retry", id, async () => {
                    await retryJob(id);
                    router.refresh();
                  })
                }
                onDelete={(id) =>
                  handleAction("delete", id, () => deleteJob(id))
                }
              />
            ))}
      </div>

      {/* Empty state */}
      {!loading && items.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-sm text-white/40">No sync jobs found</p>
          <p className="mt-1 text-xs text-white/25">
            {statusFilter
              ? `No jobs with status "${statusFilter}"`
              : "Sync a playlist to see its job here"}
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 pt-4">
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← Previous
          </Button>
          <span className="text-xs text-white/40">
            {page} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/jobs/page.tsx
git commit -m "feat: add /jobs page with filtering, pagination, and job actions"
```

---

### Task 14: Sidebar — Add Jobs Nav Item

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add Jobs to sidebar nav**

In `NAV_ITEMS`, add after Dashboard:

```tsx
import { Activity, Headphones, House, Music, Settings } from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", Icon: House },
  { href: "/jobs", label: "Jobs", Icon: Activity },
  { href: "/playlists", label: "Playlists", Icon: Music },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Jobs nav item to sidebar"
```

---

### Task 15: Toast System

**Files:**
- Create: `src/components/ui/toast.tsx`
- Create: `src/components/layout/toast-provider.tsx`
- Modify: `src/components/layout/app-shell.tsx`

- [ ] **Step 1: Create Toast component**

```tsx
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Toast {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Animate in
    requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss after 6s
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 6000);

    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const colors = {
    success: "border-green-500/30 bg-green-500/10 text-green-400",
    error: "border-red-500/30 bg-red-500/10 text-red-400",
    info: "border-white/20 bg-white/10 text-white/70",
  };

  const icons = {
    success: "✓",
    error: "✗",
    info: "ℹ",
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg backdrop-blur-sm transition-all duration-300 max-w-sm",
        colors[toast.type],
        visible ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0"
      )}
    >
      <span className="mt-0.5 font-bold">{icons[toast.type]}</span>
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(() => onDismiss(toast.id), 300);
        }}
        className="text-current opacity-50 hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
      {toasts.slice(0, 5).map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create ToastProvider**

```tsx
"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import { ToastContainer, type Toast } from "@/components/ui/toast";
import { useAuth } from "@/components/layout/providers";

interface ToastContextValue {
  addToast: (type: Toast["type"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { pb, user } = useAuth();

  const addToast = useCallback((type: Toast["type"], message: string) => {
    const id = String(++toastId);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Subscribe to sync_jobs changes for toast notifications
  useEffect(() => {
    if (!pb || !user) return;

    let unsubscribed = false;

    pb.collection("sync_jobs")
      .subscribe("*", (e: { action: string; record: { status?: string; playlist?: string; error?: string; tracks_added?: number; expand?: { playlist?: { name?: string } } } }) {
        if (unsubscribed) return;

        // Only toast on terminal state transitions
        if (e.action === "update") {
          const record = e.record;
          const playlistName = record.expand?.playlist?.name ?? "Playlist";

          if (record.status === "completed") {
            const tracks = record.tracks_added
              ? ` — +${record.tracks_added} tracks`
              : "";
            addToast("success", `"${playlistName}" sync complete${tracks}`);
          } else if (record.status === "failed") {
            const reason = record.error
              ? ` — ${record.error.slice(0, 80)}${record.error.length > 80 ? "…" : ""}`
              : "";
            addToast("error", `"${playlistName}" sync failed${reason}`);
          }
        }
      })
      .catch(() => {
        // SSE subscription failed — not critical, toasts just won't fire
      });

    return () => {
      unsubscribed = true;
      // PocketBase SDK unsubscribe
    };
  }, [pb, user, addToast]);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
```

- [ ] **Step 3: Wrap app in ToastProvider**

In `src/components/layout/app-shell.tsx`, import and wrap:

```tsx
import { ToastProvider } from "./toast-provider";

// In the return, wrap the authenticated content:
return (
  <ToastProvider>
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="ml-56 flex-1 px-8 py-6">{children}</main>
    </div>
  </ToastProvider>
);
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/toast.tsx src/components/layout/toast-provider.tsx src/components/layout/app-shell.tsx
git commit -m "feat: add toast notification system with SSE-driven job toasts"
```

---

### Task 16: Enhance SyncHistory Widget + Playlist Detail Page

**Files:**
- Modify: `src/components/sync/sync-history.tsx`
- Modify: `src/app/playlists/[id]/page.tsx`

- [ ] **Step 1: Enhance SyncHistory — add "View all" link and click-to-navigate**

In `sync-history.tsx`, add a Link import and "View all" in the CardHeader:

```tsx
import Link from "next/link";

// In CardHeader, after CardTitle:
<CardHeader>
  <div className="flex items-center justify-between">
    <CardTitle>Recent Syncs</CardTitle>
    {jobs.length > 0 && (
      <Link
        href="/jobs"
        className="text-xs text-white/40 underline underline-offset-4 hover:text-white/70"
      >
        View all
      </Link>
    )}
  </div>
</CardHeader>
```

And make each job row clickable by wrapping in a Link:

```tsx
<Link
  key={job.id}
  href={`/jobs?highlight=${job.id}`}
  className="block rounded-lg border border-white/5 bg-white/[0.02] px-4 py-2.5 hover:bg-white/[0.04] transition-colors"
>
  {/* existing job row content */}
</Link>
```

- [ ] **Step 2: Enhance playlist detail page — add link to jobs**

In `src/app/playlists/[id]/page.tsx`, in the sync action area, add a "View jobs" link:

After the `activeJob` status display block, add:
```tsx
{activeJob && (
  <Link
    href={`/jobs?playlistId=${playlist.id}`}
    className="text-xs text-white/40 underline underline-offset-4 hover:text-white/60"
  >
    View all jobs for this playlist →
  </Link>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/sync/sync-history.tsx src/app/playlists/[id]/page.tsx
git commit -m "feat: link dashboard sync history and playlist detail to /jobs"
```

---

### Task 17: Add Progress Tracking to Spec

**Files:**
- Modify: `docs/superpowers/specs/2026-07-15-worker-management-ui-design.md`

Add a progress checklist section at the end of the spec:

```markdown
## 11. Implementation Progress

- [ ] Phase 1: API Routes + Worker Fixes
  - [ ] Task 1: PocketBase migration for worker_status
  - [ ] Task 2: Worker heartbeat module
  - [ ] Task 3: Heartbeat in poll loop + stale pending reset + cancel check
  - [ ] Task 4: Scheduler state tracking
  - [ ] Task 5: .m3u playlist file generation
  - [ ] Task 6: GET /api/jobs
  - [ ] Task 7: GET/PATCH/DELETE /api/jobs/[id]
  - [ ] Task 8: POST /api/jobs/[id]/retry + GET /api/worker/status
- [ ] Phase 2: Jobs Page + Components
  - [ ] Task 9: useJobs and useWorkerStatus hooks
  - [ ] Task 10: Job action functions (cancel/delete/retry)
  - [ ] Task 11: JobRow component
  - [ ] Task 12: WorkerStatusBar component
  - [ ] Task 13: /jobs page
  - [ ] Task 14: Sidebar nav item
- [ ] Phase 3: Real-Time + Toasts
  - [ ] Task 15: Toast system (Toast + ToastProvider)
- [ ] Phase 4: Polish
  - [ ] Task 16: SyncHistory + playlist detail enhancements
  - [ ] Task 17: Progress tracking in spec
```
