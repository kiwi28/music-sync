# Worker Management UI — Design Spec

**Date:** 2026-07-15
**Status:** Approved
**Context:** The worker logs show jobs stuck in pending/running state with no visibility from the frontend. There is no UI to view, manage, or debug sync jobs beyond a basic 5-item history list on the dashboard. The user needs full visibility and control over the worker, jobs, logs, scheduler, and sync progress — all from the frontend.

---

## 1. Goals

1. **Job management page** (`/jobs`) — list all sync jobs with status, playlist, timestamps, and actions (retry, cancel, delete)
2. **Live log streaming** — real-time log updates via PocketBase SSE subscriptions instead of 5s polling
3. **Job actions API** — cancel running jobs, delete records, retry failed jobs
4. **Worker health visibility** — show whether the worker is alive, last poll time, scheduler status
5. **Toast notifications** — global toast system for job completion/failure events
6. **Stale job recovery** — detect and surface stuck pending/running jobs with one-click reset

---

## 2. API Routes (New)

All routes use user-session auth via `createServerClient()`. Filtering is always scoped to the authenticated user.

### `GET /api/jobs`

List sync jobs for the current user. Supports query params:
- `status` — filter by status (`pending`, `running`, `completed`, `failed`)
- `playlistId` — filter by playlist
- `page` / `perPage` — pagination (default 1 / 20)

Response: `{ items: SyncJob[], page: number, perPage: number, totalItems: number, totalPages: number }`

Jobs include expanded playlist (`expand: "playlist"`) so playlist names are available without N+1 queries.

### `GET /api/jobs/[id]`

Get a single job by ID. Includes expanded playlist. Returns 404 if not found or not owned by the current user.

### `PATCH /api/jobs/[id]`

Update a job. Supported operations:
- **Cancel**: set `status: "failed"`, `error: "Cancelled by user"`, `completed_at: now`. Only allowed for jobs in `pending` or `running` status. Returns 409 if the job is already in a terminal state (`completed` or `failed`).
- **Reset**: set `status: "pending"`, clear `error`, `started_at`, `completed_at`. Only allowed for jobs in `failed` status. This is an alternative to retry for jobs that failed and should be re-queued without creating a new job record.

Body: `{ action: "cancel" | "reset" }`

### `DELETE /api/jobs/[id]`

Delete a job record. Only allowed for jobs in a terminal state (`completed` or `failed`). Returns 409 if the job is pending/running (must cancel first). Returns 404 if not found or not owned.

### `POST /api/jobs/[id]/retry`

Create a new pending sync job for the same playlist as the given job. This is the preferred way to retry a failed job — it creates a fresh job record rather than mutating the old one. Returns the new job. Returns 404 if the original job is not found.

### `GET /api/worker/status`

Returns worker health information by reading the `worker_status` singleton record from PocketBase (see §5). Returns:
```json
{
  "online": true,
  "lastPollAt": "2026-07-15T...",
  "lastPollSecondsAgo": 3,
  "scheduler": {
    "lastCheckAt": "2026-07-15T...",
    "nextCheckAt": "2026-07-15T...",
    "syncIntervalMinutes": 10080,
    "checkIntervalMinutes": 240,
    "stalePlaylistCount": 2
  },
  "stats": {
    "pendingJobs": 0,
    "runningJobs": 1,
    "staleRunningJobs": 0
  }
}
```

If the `worker_status` record doesn't exist or is older than 2 minutes, `online` is `false`.

---

## 3. Frontend Pages & Components

### 3.1 New Page: `/jobs`

Full job management console. Layout:

```
┌──────────────────────────────────────────────────────┐
│  Jobs                          [Filters] [Actions]   │
│  ┌──────────────────────────────────────────────────┐ │
│  │ Worker: ● Online (3s ago) · Scheduler: 4h check  │ │ ← WorkerStatusBar
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │ ● Running · "Summer Mix" · Spotify · +12 tracks  │ │ ← JobRow
│  │   Started 2m ago · Log: "Downloading 8 tracks…"  │ │
│  │   [Cancel]                                       │ │
│  ├──────────────────────────────────────────────────┤ │
│  │ ✓ Completed · "Workout Jams" · YTM · +45 tracks  │ │
│  │   1h ago · Log: "Sync complete. 45 new, 45 total"│ │
│  │   [Retry] [Delete]                               │ │
│  ├──────────────────────────────────────────────────┤ │
│  │ ✗ Failed · "Chill Vibes" · Spotify · 0 tracks    │ │
│  │   2d ago · Error: "spotdl download failed: ..."   │ │
│  │   [Retry] [Delete]                               │ │
│  └──────────────────────────────────────────────────┘ │
│                    « 1 of 3 »                         │
└──────────────────────────────────────────────────────┘
```

**Features:**
- Status filter tabs (All / Pending / Running / Completed / Failed)
- Each job row shows: status icon, playlist name, platform, time since start, tracks added, expandable log/error
- Actions depend on status: running→Cancel, failed→Retry+Delete, completed→Retry+Delete, pending→Cancel+Delete
- Pagination
- Real-time status updates for active jobs via SSE subscription
- Empty state: "No sync jobs yet"

### 3.2 New Component: `JobRow`

A single job row. Props: `job: SyncJob`, `onAction: (action, jobId) => void`.

- Status badge (colored: green=completed, amber=running, gray=pending, red=failed)
- Playlist name (link to playlist detail)
- Platform icon + label
- Relative timestamps (started, completed)
- Tracks added count (green if >0)
- Expandable log section (click to expand, shows full `job.log` and `job.error`)
- For running jobs: live-updating log text via SSE subscription
- Action buttons (contextual by status)

### 3.3 New Component: `JobDetailSheet`

Slide-out panel (or modal) showing full job details. Triggered by clicking a job row.

Shows: full log, error details, timestamps, playlist link, track counts. For running jobs, the log streams live.

### 3.4 New Component: `WorkerStatusBar`

Thin status bar at the top of `/jobs` showing:
- Worker status dot (green/yellow/red based on last poll recency)
- "Worker online — last poll 3s ago" or "Worker offline — last poll 2m ago"
- Scheduler: "Next check in 3h 45m"
- Stale job count: "2 stale jobs detected" with a "Reset all" button

Data comes from `useWorkerStatus()` hook which calls `GET /api/worker/status` and also subscribes to PocketBase SSE on the `worker_status` collection.

### 3.5 New Component: `ToastSystem`

Global toast notification system. Implemented as a React context provider at the app shell level.

**Architecture:**
- `ToastProvider` wraps the app (in `providers.tsx` or `app-shell.tsx`)
- A `useEffect` subscribes to PocketBase SSE on `sync_jobs` collection for the current user
- On job status change to `completed` or `failed`, fires a toast
- Toast component: slide-in from top-right, auto-dismiss after 6s, closeable
- Toast variants: success (green, completed), error (red, failed), info (neutral)

Toasts show:
- Completed: "✓ "Playlist Name" synced — +12 tracks"
- Failed: "✗ "Playlist Name" sync failed — spotdl download error"

### 3.6 Enhanced: `Sidebar`

Add "Jobs" nav item between Dashboard and Playlists:

```tsx
{ href: "/jobs", label: "Jobs", Icon: Activity },  // lucide-react Activity icon
```

### 3.7 Enhanced: `SyncHistory` (dashboard widget)

The existing dashboard widget gets:
- Click on a job row → navigate to `/jobs?highlight=<jobId>`
- "View all" link → `/jobs`
- Real-time status updates via shared SSE subscription

### 3.8 Enhanced: Playlist Detail Page (`/playlists/[id]`)

- Replace 5s polling with PocketBase SSE subscription for the active job
- Show live log stream instead of static text
- Add "View all jobs" link to `/jobs?playlistId=<id>`

---

## 4. Hooks (New & Enhanced)

### `useJobs(filters?)`

Replaces the existing `useSyncJobs` with full filtering/pagination support. Calls `GET /api/jobs`.

### `useWorkerStatus()`

Polls `GET /api/worker/status` every 30s + subscribes to PocketBase SSE on `worker_status` for instant updates when the worker writes a new heartbeat.

### `useJobSubscription(userId)`

Generic hook: subscribes to PocketBase SSE on the `sync_jobs` collection for the given user. Returns the latest event. Used by the toast system and the jobs page.

### Enhanced: `useActiveSyncJob(playlistId)`

Replace `setInterval` polling with PocketBase SSE subscription. Filters by playlist ID.

### Enhanced: `useActiveSyncJobs()`

Replace `setInterval` polling with PocketBase SSE subscription.

---

## 5. Worker Changes

The worker needs small additions to support the UI's visibility needs.

### 5.1 Worker Status Heartbeat

After each poll loop iteration, the worker writes to a singleton record in a new `worker_status` collection:

```js
// worker/src/heartbeat.js (new file)
async function updateHeartbeat(pb) {
  const status = await pb.collection("worker_status").getList(1, 1);
  const record = status.items[0];

  const data = {
    last_poll_at: new Date().toISOString(),
    pending_count: /* count of pending jobs */,
    running_count: /* count of running jobs */,
  };

  if (record) {
    await pb.collection("worker_status").update(record.id, data);
  } else {
    await pb.collection("worker_status").create(data);
  }
}
```

### 5.2 Scheduler State Tracking

The scheduler writes its state after each tick:

```js
// In schedulerTick(), after processing:
await pb.collection("worker_status").update(record.id, {
  scheduler_last_check_at: new Date().toISOString(),
  scheduler_next_check_at: new Date(Date.now() + CHECK_INTERVAL_MS).toISOString(),
  scheduler_sync_interval_minutes: SYNC_INTERVAL_MINUTES,
  scheduler_check_interval_minutes: Math.round(CHECK_INTERVAL_MS / 60_000),
  scheduler_stale_playlist_count: stalePlaylistCount,
});
```

### 5.3 Job Cancellation Check

At the start of `processJob()`, after fetching the playlist, check if the job was cancelled:

```js
// In processJob(), before marking as "running":
const freshJob = await pb.collection("sync_jobs").getOne(job.id);
if (freshJob.status === "failed" && freshJob.error === "Cancelled by user") {
  console.log(`[worker] Job ${job.id} was cancelled, skipping`);
  return;
}
```

### 5.4 Stale Pending Job Reset

Enhance `resetStaleJobs()` to also reset **pending** jobs older than 60 minutes (not just running jobs):

```js
// Current: only resets "running" jobs
// New: also resets "pending" jobs older than 60 minutes
const stalePendingJobs = await pb.collection("sync_jobs").getList(1, 100, {
  filter: 'status = "pending"',
});
// Filter in JS for jobs older than 60 min, reset them too
```

### 5.5 Generate .m3u Playlist File After Download

After a successful sync, generate an `.m3u` file in the playlist's download folder so Navidrome and other players can import it as a local playlist. This runs in both download handlers (`spotdl.js` and `ytdlp.js`) as a final step after all tracks are downloaded.

Implementation (new utility function in `worker/src/utils.js`):

```js
import { execFile } from "node:child_process";
import { join } from "node:path";

export function generateM3u(dirPath, playlistName) {
  return new Promise((resolve, reject) => {
    const m3uPath = join(dirPath, `${playlistName}.m3u`);
    // List audio files and write to .m3u in one shell command.
    // The .m3u format is just a newline-separated list of filenames.
    execFile(
      "sh", ["-c", `cd "${dirPath}" && ls *.mp3 *.flac *.m4a 2>/dev/null > "${m3uPath}"`],
      { timeout: 10000 },
      (err) => {
        if (err) {
          console.error(`[m3u] Failed to generate .m3u for "${playlistName}":`, err.message);
          resolve(); // Non-fatal — don't fail the sync over a missing .m3u
        } else {
          console.log(`[m3u] Generated "${playlistName}.m3u"`);
          resolve();
        }
      }
    );
  });
}
```

Called at the end of `processSpotifyJob()` and `processYoutubeMusicJob()`, after track records are created and before the job is marked as completed. The `playlistName` is sanitized with the existing `sanitizeFolderName()` utility so the filename is safe.

---

## 6. Data Model Changes

### New Collection: `worker_status`

A singleton collection (one record) that the worker updates with its health/status.

| Field | Type | Description |
|---|---|---|
| `last_poll_at` | date | When the worker last completed a poll loop |
| `pending_count` | number | Current pending job count |
| `running_count` | number | Current running job count |
| `scheduler_last_check_at` | date | When the scheduler last ran a tick |
| `scheduler_next_check_at` | date | When the scheduler will run next |
| `scheduler_sync_interval_minutes` | number | Configured sync window |
| `scheduler_check_interval_minutes` | number | Configured check interval |
| `scheduler_stale_playlist_count` | number | Count of stale playlists found in last tick |

**Access rules:**
- `listRule`: `""` (any authenticated user can read — it's infrastructure status, not user data)
- `viewRule`: `""`
- `createRule`: `@request.auth.id != ''`
- `updateRule`: `@request.auth.id != ''`
- `deleteRule`: `@request.auth.id != ''`

---

## 7. PocketBase SSE Integration

PocketBase supports real-time subscriptions via SSE at:

```
GET /api/collections/sync_jobs/records?filter=(user='<userId>')
```

With the `SSE` header, it streams create/update/delete events. The browser SDK has built-in support:

```ts
// In a hook or context provider:
const unsubscribe = await pb.collection("sync_jobs").subscribe("*", (e) => {
  // e.action: "create" | "update" | "delete"
  // e.record: the full SyncJob record
  if (e.action === "update" && e.record.status === "completed") {
    toast.success(`"${e.record.expand?.playlist?.name}" synced`);
  }
});
```

The nginx proxy at `/pb/*` already handles SSE (it's just HTTP, no WebSocket upgrade needed).

---

## 8. Implementation Order

The work is organized into phases, each independently testable:

### Phase 1: API Routes + Worker Fixes
1. Create PocketBase migration for `worker_status` collection
2. Add worker heartbeat module (`worker/src/heartbeat.js`)
3. Add job cancellation check to worker `processJob()`
4. Enhance `resetStaleJobs()` to also reset stale pending jobs
5. Add scheduler state tracking to `scheduler.js`
6. Create API routes: `GET/PATCH/DELETE /api/jobs/[id]`, `POST /api/jobs/[id]/retry`, `GET /api/jobs`, `GET /api/worker/status`

### Phase 2: Jobs Page + Components
7. Create `/jobs` page with `JobList`, `JobRow`, filtering, pagination
8. Create `WorkerStatusBar` component
9. Create `JobDetailSheet` component
10. Add "Jobs" to sidebar navigation
11. Create `useJobs` and `useWorkerStatus` hooks

### Phase 3: Real-Time + Toasts
12. Create `ToastProvider` and `Toast` components
13. Integrate toast system into app shell
14. Add SSE subscriptions to jobs page for live updates
15. Replace polling in `useActiveSyncJob` with SSE
16. Replace polling in `useActiveSyncJobs` with SSE

### Phase 4: Polish
17. Enhance dashboard `SyncHistory` with real-time status and navigation
18. Enhance playlist detail page with live log streaming
19. Add stale job detection to `WorkerStatusBar` with reset button
20. Error states, loading states, empty states for every component

---

## 9. Error Handling

| Scenario | Handling |
|---|---|
| API route auth failure | 401, redirect to login |
| API route ownership check | 403, generic error |
| Job not found | 404, toast |
| Cancel already-terminal job | 409, surface conflict message |
| Worker offline | WorkerStatusBar shows red dot, "offline" text |
| SSE connection lost | Auto-reconnect (PocketBase SDK handles this), show subtle "reconnecting" indicator |
| Toast queue overflow | Max 5 visible toasts, older ones dismissed |

---

## 10. Verification

After implementation, verify:
1. `GET /api/jobs` returns paginated, user-scoped jobs with expanded playlists
2. `PATCH /api/jobs/[id] { action: "cancel" }` sets status to failed, worker skips it
3. `DELETE /api/jobs/[id]` removes terminal job, returns 409 for active job
4. `POST /api/jobs/[id]/retry` creates a new pending job for the same playlist
5. `GET /api/worker/status` shows heartbeat data after worker runs one poll loop
6. `/jobs` page loads, filters work, real-time updates appear for running jobs
7. Toast appears when a job completes or fails
8. Worker resets stale pending jobs on restart
9. Dashboard SyncHistory widget still works, links to /jobs
10. Sidebar has "Jobs" nav item, active state works

---

## 11. Implementation Progress

- [ ] Phase 1: API Routes + Worker Fixes
  - [x] Task 1: PocketBase migration for worker_status
  - [x] Task 2: Worker heartbeat module
  - [x] Task 3: Heartbeat in poll loop + stale pending reset + cancel check
  - [x] Task 4: Scheduler state tracking
  - [x] Task 5: .m3u playlist file generation
  - [x] Task 6: GET /api/jobs
  - [x] Task 7: GET/PATCH/DELETE /api/jobs/[id]
  - [x] Task 8: POST /api/jobs/[id]/retry + GET /api/worker/status
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
