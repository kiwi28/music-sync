# Music Sync — Project Vision & Conventions

## What This Project Is

A self-hosted, mobile-first web app for tracking and syncing music playlists across platforms. You paste a public playlist URL (Spotify, YouTube Music, Apple Music, Tidal, Deezer), the app auto-detects the platform, saves the playlist to PocketBase, and a background worker downloads all tracks via `spotdl` or `yt-dlp` into a shared `/music` volume organized by playlist name. Each sync is logged with a detailed summary in PocketBase.

## User Experience Goals

- **Mobile-first React UI** — responsive, touch-friendly, dark theme
- **Paste a URL** — platform auto-detected from URL. User can override the playlist name or leave blank to auto-name.
- **Background sync** — the worker runs independently of the browser. Closing the tab doesn't stop the download. When the user comes back, sync progress is visible in the dashboard and sync history.
- **Weekly cron** — playlists auto-sync on a schedule (planned, not yet implemented)
- **Navidrome streaming** — a Navidrome instance mounts the shared `/music` volume so synced tracks can be streamed (planned, not yet implemented)

## Architecture

```
Browser (Next.js 16, port 3100)
    │
    ├── REST API ──► Next.js API routes ──► PocketBase (port 8090)
    │                      │
    │   POST /api/sync creates a "pending" sync_job
    │                      │
    │                      ▼
    │               Worker (Node.js, separate container)
    │               polls PocketBase every 15s for pending jobs
    │               dispatches to spotdl / yt-dlp
    │               downloads to /music/<playlist-name>/
    │               creates track records in PocketBase
    │               updates job status → "completed" or "failed"
    │
    └── JS SDK ──► PocketBase (via nginx proxy at /pb/)
```

### Services (docker-compose)

| Service | Tech | Purpose |
|---|---|---|
| `app` | Next.js 16.2, React 19.2, Tailwind 4 | Web UI + API routes |
| `pocketbase` | PocketBase (Go binary) | Auth, database, admin UI |
| `worker` | Node.js | Background download worker (spotdl, yt-dlp) |

All services communicate on the internal Docker network. The Next.js app proxies `/pb/*` to PocketBase via nginx so the browser JS SDK works without CORS issues.

## Data Model (PocketBase Collections)

- **users** — PocketBase built-in auth
- **playlists** — `name`, `url`, `platform`, `platform_id`, `user` (relation), `track_count`, `last_synced`, `cover_url`, `is_public`
- **tracks** — `title`, `artist`, `album`, `platform`, `platform_id`, `duration_ms`, `isrc`, `cover_url`
- **playlist_tracks** — junction: `playlist` (relation), `track` (relation), `position`, `added_at`
- **sync_jobs** — `playlist` (relation), `user` (relation), `status` (pending/running/completed/failed), `started_at`, `completed_at`, `tracks_added`, `tracks_removed`, `error`, `log`

## Supported Platforms

| Platform | Domain | Download via |
|---|---|---|
| Spotify | `open.spotify.com` | `spotdl` |
| YouTube Music | `music.youtube.com` | `yt-dlp` |
| Apple Music | `music.apple.com` | Not yet implemented |
| Tidal | `tidal.com` | Not yet implemented |
| Deezer | `deezer.com` | Not yet implemented |

## Sync Flow (end to end)

1. User pastes a playlist URL → platform auto-detected → saved to `playlists` collection
2. User clicks "Sync" on a playlist → `POST /api/sync` creates a `sync_job` with status `"pending"`
3. Worker picks up the pending job → marks `"running"` → dispatches to the platform handler
4. Handler runs `spotdl` or `yt-dlp`, downloads files to `/music/<playlist-name>/`
5. Handler deduplicates against existing tracks, creates `track` and `playlist_track` records
6. Worker updates `sync_job` → `"completed"` with counts; updates `playlist.last_synced` and `playlist.track_count`
7. On failure, `sync_job` is marked `"failed"` with error details

The worker polls every 15s and processes one job at a time. Stale `"running"` jobs (older than 10 minutes on startup) are reset to `"pending"`.

## Codebase Conventions

### Client/Server Boundary

- `src/lib/pocketbase.ts` — browser-side PB client (singleton, uses `NEXT_PUBLIC_POCKETBASE_URL`)
- `src/lib/pocketbase-server.ts` — server-side PB client (reads auth cookie, marked `"server-only"`)
- `src/lib/flash.ts` / `flash-server.ts` — same pattern for flash messages
- API routes live in `src/app/api/`, use `createServerClient()` and validate with Zod schemas from `src/lib/validators.ts`
- Client components use `useAuth()` context (provides `pb` + `user`)

### UI Patterns

- Mobile-first, dark theme (Tailwind `neutral` palette, `bg-neutral-900` base)
- shadcn-style components in `src/components/ui/` — thin wrappers, `clsx` + `tailwind-merge`
- Loading states everywhere — skeleton placeholders while data fetches
- Empty states with helpful messaging (e.g. "No playlists yet — paste a URL to get started")

### TypeScript

- Domain types in `src/lib/types.ts` — the source of truth
- Zod schemas in `src/lib/validators.ts` — runtime validation matching the types
- PocketBase relations use `expand?` for populated joins (e.g. `expand?: { playlist?: Playlist }`)

### Worker

- Standalone Node.js app in `worker/` — no shared code with Next.js (intentional, to keep the worker image small)
- Authenticates as PocketBase superuser to operate across all user accounts
- Platform handlers in `worker/src/downloads/` — one file per platform
- Dedup logic in `worker/src/dedup.js` — checks track IDs before creating records

## Planned / Missing

- [x] **Weekly cron** — `worker/src/scheduler.js` periodically checks all playlists and creates pending sync_jobs for any not synced within `SYNC_INTERVAL_MINUTES` (default 7 days). Runs independently of the job poll loop.
- [x] **Navidrome** — Navidrome service in docker-compose, mounts the shared `/music` volume read-only. Served at `spoty.kiw.ro` via nginx.
- [ ] **Real-time sync progress** — currently the UI polls on mount/reload; could use PB's realtime subscriptions
- [ ] **Download handlers for Apple Music, Tidal, Deezer** — worker only handles Spotify and YouTube Music
- [ ] **Audio fingerprint dedup** — currently dedup is ID-based; identical tracks from different platforms would duplicate

## Environment Variables

See `.env.example` for the full list. Key ones:
- `POCKETBASE_URL` — internal Docker network URL (server-side)
- `NEXT_PUBLIC_POCKETBASE_URL` — public URL via nginx proxy (browser-side)
- `PB_SUPERUSER_EMAIL` / `PB_SUPERUSER_PASSWORD` — worker auth
- `MUSIC_DIR` — where downloaded music lives (`/music` in containers)
- `POLL_INTERVAL` — worker poll interval in ms (default 15000)
- `SYNC_INTERVAL_MINUTES` — how often existing playlists are re-synced (default 10080 = 7 days)
