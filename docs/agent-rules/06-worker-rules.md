# 06 — Worker Rules

The worker is a standalone Node.js app in `worker/`. It runs `spotdl` and `yt-dlp` as child processes to download music. It shares NO code with the Next.js app (intentional — keeps the worker image small and avoids bundling Next.js).

---

## Rule W1: Worker Is JavaScript, Not TypeScript

All worker code is plain `.js` with ES modules (`"type": "module"` in `package.json`). Do not add TypeScript files to `worker/` unless you also add a compile step to the Dockerfile. Use JSDoc for type annotations.

## Rule W2: `metadata.js` Must Exist

Both `spotdl.js` and `ytdlp.js` import `{ parseFileMetadata }` from `../metadata.js`. This file is **currently missing** — it must be created before the worker can process any job.

The `parseFileMetadata(filePath)` function should:
1. Shell out to `ffprobe -v quiet -print_format json -show_format -show_streams <file>`
2. Parse the JSON output
3. Return `{ title, artist, album, durationMs, isrc }` with fallbacks to tag-matching heuristics

The `ffprobe` binary is already available in the Docker image (comes with `ffmpeg` package).

## Rule W3: Platform Handler Pattern

Every new platform handler must follow this contract:

```js
/**
 * Process a playlist sync job for a specific platform.
 * @param {object} playlist - PocketBase playlist record
 * @param {string} playlist.id
 * @param {string} playlist.name
 * @param {string} playlist.url
 * @param {string} playlist.platform
 * @returns {Promise<{ tracksAdded: number, totalTracks: number }>}
 */
export async function processPlatformJob(playlist) {
  // Phase 1: Fetch metadata from platform
  // Phase 2: Dedup against PocketBase
  // Phase 3: Download new tracks
  // Phase 4: Create Track + PlaylistTrack records
  return { tracksAdded, totalTracks };
}
```

All four phases must be implemented. Never skip dedup (Phase 2).

## Rule W4: Register Handler in `HANDLERS` Map

After creating a new platform handler, register it in `worker/src/worker.js`:

```js
const HANDLERS = {
  spotify: processSpotifyJob,
  youtube_music: processYoutubeMusicJob,
  // ADD NEW HANDLERS HERE
};
```

Without this, the worker will mark jobs for that platform as "failed: unsupported platform".

## Rule W5: Dedup Logic Is Shared

`worker/src/dedup.js` exports `findExistingTrack()` — use it from every platform handler. The dedup checks in priority order:

1. ISRC match (international standard recording code — gold standard)
2. platform + platform_id match (e.g., Spotify track ID)
3. title + artist + platform fuzzy match (~ operator)

Never implement your own dedup in a handler. If you need a new dedup strategy, add it to `findExistingTrack()` so all platforms benefit.

## Rule W6: File Organization Under `/music`

Downloaded files go to `/music/<platform>/<playlist-name>/`:

```
/music/
  spotify/
    Chill Vibes/
      Artist - Title.mp3
  youtube_music/
    Workout Mix/
      01 - Song Name.mp3
```

Use `sanitizeFolderName()` from `utils.js` to clean playlist names for filesystem use. Use `ensureDir()` to create directories recursively.

## Rule W7: Timeouts on Child Processes

All `execFileAsync()` calls must have a `timeout`:

| Operation | Timeout | Rationale |
|---|---|---|
| `spotdl save` (metadata) | 120s | API call, should be fast |
| `spotdl download` | 1800s (30m) | Large playlists take time |
| `yt-dlp --dump-json` (metadata) | 120s | API call |
| `yt-dlp -x` (download) | 1800s (30m) | Can be very slow |

Never call `execFileAsync` without a timeout — a hung process will block the worker forever.

## Rule W8: Clean Up Temporary Files

Metadata files written to `/tmp/` (spotdl JSON output) MUST be deleted after use:

```js
try {
  const raw = await readFile(metadataFile, "utf-8");
  // ...
} finally {
  await unlink(metadataFile).catch(() => {});
}
```

Use `finally` blocks — not just `try/catch` — to ensure cleanup even on success.

## Rule W9: Job State Transitions

A sync_job goes through exactly these states:

```
pending → running → completed
                  → failed
```

- **pending → running:** Set `started_at` and update `log`. Never leave a job pending once processing starts.
- **running → completed:** Set `completed_at`, `tracks_added`, `log`. Update `playlist.track_count` and `playlist.last_synced`.
- **running → failed:** Set `completed_at`, `error`, `log`. Never leave a job stuck in "running" on error.

The worker's `processJob()` function handles ALL transitions. A handler should never directly update job status.

## Rule W10: Stale Job Recovery

On startup, the worker resets jobs that are stuck in "running" for > 10 minutes:

```js
filter: `status = "running" && created < "${tenMinutesAgo}"`
```

This handles the case where the worker crashes mid-download. When adding new job states or changing the download timeout, update this filter to match.

## Rule W11: Scheduler Runs Independently

`worker/src/scheduler.js` runs on its own interval (separate from the poll loop). It creates pending jobs for playlists that haven't been synced within `SYNC_INTERVAL_MINUTES`. Key rules:

- Never create a job if one is already `pending` or `running` for that playlist
- The scheduler uses admin auth — it can create jobs for any user
- `timer.unref()` allows clean shutdown (though the poll loop keeps the process alive)

## Rule W12: Error Messages Are User-Visible

Error messages stored in `sync_job.error` and `sync_job.log` appear in the UI (`sync-history.tsx`). Keep them:
- Under 500 characters (`extractErrorMessage` truncates)
- Human-readable (not stack traces)
- Actionable ("Playlist URL not found" not "HTTPError: 404")

## Rule W13: `withTimeout` Pattern (Not Yet Implemented)

The worker does NOT currently have request-level timeouts on PocketBase calls. If PocketBase hangs, the worker hangs. The server-side code uses a `withTimeout` pattern — this should be added to the worker's `pb-client.js`:

```js
async function withTimeout(promise, ms, label) {
  // Same pattern as src/lib/pocketbase-server.ts
}
```

## Rule W14: Worker Dependencies Are Minimal

`worker/package.json` has only `pocketbase` as a dependency. Do not add large packages (express, axios, etc.). The worker image is kept small intentionally. Use Node.js built-ins (`fetch`, `child_process`, `fs/promises`, `path`).
