# Music Sync

Self-hosted playlist sync — paste a Spotify or YouTube Music playlist URL, and the app downloads every track in the background. Syncs are logged with detailed summaries so you always know what changed.

**Currently supports:** Spotify (via `spotdl`) and YouTube Music (via `yt-dlp`). Apple Music, Tidal, and Deezer URL parsing is implemented but download handlers are pending.

## How it works

1. **Paste a public playlist URL** — platform is auto-detected. Give it a custom name or leave blank.
2. **Sync starts immediately** — a background worker picks up the job and downloads all tracks to organized folders. New playlists sync right away; existing playlists are re-synced weekly (configurable) to catch new tracks.
3. **Close the tab** — the worker runs independently. Come back anytime to see progress.
4. **Stream** — A Navidrome instance at `spoty.kiw.ro` mounts the same music volume for streaming via web or any Subsonic-compatible app.

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Next.js UI │────►│  PocketBase │◄────│   Worker    │
│ (port 3100) │     │ (port 8090) │     │ (spotdl/yt) │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
┌─────────────┐                           /music volume
│  Navidrome  │◄──────────────────────────────┘
│ (port 4533) │
└─────────────┘
```

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A domain with nginx reverse proxy (see `nginx-musicsync.conf`)

### Setup

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — set strong passwords and your public domain

# 2. Start everything
docker compose up -d

# 3. Create your user
# Open https://your-domain.com and register an account
```

The PocketBase admin UI is available at `https://your-domain.com/pb/_/`.

### Development

```bash
# Start PocketBase locally (optional — or use the Docker one)
./pocketbase.exe serve

# Start Next.js dev server
npm run dev
# Opens on http://localhost:3100
```

## Project Structure

```
src/
  app/                  Next.js App Router pages
    api/                API routes (sync, pocketbase proxy)
    login/              Auth page
    playlists/          Playlist list + detail pages
    settings/           User settings
  components/
    auth/               Login/register forms
    layout/             App shell, sidebar, providers
    playlists/          Playlist cards, add dialog, track list
    sync/               Sync history widget
    ui/                 Shared UI kit (button, card, input, badge, etc.)
  hooks/                Data fetching hooks (usePlaylists, useSyncJobs)
  lib/                  Types, validators, PB clients, URL utils

worker/                 Background download worker (separate Node.js app)
  src/
    downloads/          spotdl and yt-dlp wrappers
    scheduler.js        Weekly re-sync cron for existing playlists
    worker.js           Main loop — polls PB, dispatches jobs
```

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 16, React 19, Tailwind CSS 4, shadcn-style components |
| Backend | Next.js API routes, PocketBase (Go/SQLite) |
| Worker | Node.js, spotdl, yt-dlp |
| Streaming | Navidrome (Subsonic API) |
| Auth | PocketBase built-in auth (email/password) |
| Infra | Docker, nginx reverse proxy |
