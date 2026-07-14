# 09 — Docker & Infrastructure Rules

This project uses Docker Compose with three services + Navidrome. Configuration spans `Dockerfile`, `worker/Dockerfile`, `pocketbase.Dockerfile`, `docker-compose.yml`, `nginx-musicsync.conf`, and `docker-entrypoint.sh`.

---

## Rule D1: Three Dockerfiles, Three Contexts

| File | Service | What It Builds |
|---|---|---|
| `Dockerfile` (root) | `app` | Next.js production image (multi-stage) |
| `pocketbase.Dockerfile` | `pocketbase` | PocketBase binary + migrations |
| `worker/Dockerfile` | `worker` | Node.js + Python + spotdl + yt-dlp |

All build with `context: .` (project root). Be careful with COPY paths — they're relative to the project root, not the Dockerfile location.

## Rule D2: Multi-Stage Build for Next.js

The root `Dockerfile` uses two stages:
1. **Builder** — installs ALL deps (including devDeps), runs `npm run build`
2. **Runner** — production deps only, copies `.next/` output, runs as `nextjs` user

Do NOT combine into a single stage — it bloats the image with devDependencies.

## Rule D3: `--omit=dev` in Production Stages

Both the Next.js runner stage and the worker Dockerfile use `npm install --omit=dev`. Do not change this — the PocketBase JS SDK is the only production dependency for both.

## Rule D4: Worker Image — System Dependencies

The worker Dockerfile installs system packages:
- `python3` + `python3-pip` — required by spotdl
- `ffmpeg` — required by yt-dlp for audio conversion
- `spotdl` (pip) — also installs `yt-dlp` as a dependency

When upgrading `spotdl`, test that `yt-dlp` still works. They're coupled via pip.

The `--break-system-packages` flag is required on Debian Bookworm (PEP 668). Don't remove it.

## Rule D5: Docker Compose Dependencies

```
app ──────────► pocketbase (service_healthy)
worker ───────► pocketbase (service_healthy)
navidrome ──── (independent — mounts /music volume read-only)
```

The `depends_on: condition: service_healthy` ensures PocketBase is accepting requests before the app/worker start. This requires the `HEALTHCHECK` in `pocketbase.Dockerfile` — never remove it.

## Rule D6: Volume Mounts

| Volume | Services | Mode | Contains |
|---|---|---|---|
| `pb_data` | pocketbase | RW | SQLite DB, migrations, settings |
| `music` | worker, navidrome | RW (worker), RO (navidrome) | Downloaded music files |
| `navidrome_data` | navidrome | RW | Navidrome DB, config, cache |

The `music` volume is the bridge — worker writes to it, navidrome reads from it. Never remove this shared volume.

## Rule D7: Nginx Configuration

`nginx-musicsync.conf` is NOT managed by Docker. It's deployed separately on the host. Key architecture:

- `musicsync.kiw.ro` → Next.js `:3100` + `/pb/` proxy to PocketBase
- `pb.musicsync.kiw.ro` → PocketBase `:8090` (admin UI)
- `spoty.kiw.ro` → Navidrome `:4533`

The configuration includes SSL (Let's Encrypt), security headers, CSP, and WebSocket support. When modifying:
- Test with `nginx -t` before reloading
- Don't break the `/pb/` proxy — the browser PocketBase SDK depends on it
- Keep `proxy_buffering off` for PocketBase SSE and Navidrome streaming

## Rule D8: Environment Variables in Docker Compose

`docker-compose.yml` uses `${VAR:-default}` syntax for all configurable values. The defaults are safe for development but NOT for production (`change-me` passwords). Always set real values in `.env` or the host environment.

## Rule D9: Entrypoint Script

`docker-entrypoint.sh` runs in the PocketBase container:
1. Copies migrations from image (`/pb_migrations_src/`) to volume (`/pb_data/pb_migrations/`) with content comparison
2. Creates/updates the superuser
3. Starts PocketBase

The content comparison (`cmp -s`) ensures fixed migrations actually replace broken ones. Don't simplify this to a plain `cp` — it would silently skip fixes on restart.

## Rule D10: `.dockerignore` Must Stay Current

The `.dockerignore` file controls what gets sent to the Docker build context. Current exclusions:

```
node_modules
.git
.next/
.env*
.claude/         ← MUST ADD (currently missing — see Issue #26)
```

Add new large/inappropriate directories as the project grows.

## Rule D11: Navidrome Is Read-Only

Navidrome mounts `/music` as `:ro` (read-only). It streams files but never modifies them. The worker is the sole writer. Never give Navidrome write access to the music volume.

Navidrome environment:
- `ND_MUSICFOLDER: /music` — where it scans for files
- `ND_PORT: 4533` — internal port
- First-time setup: create admin user via web UI or `ND_ADMINUSER`/`ND_ADMINPASSWORD` env vars

## Rule D12: Port Exposure Is Localhost-Only

All Docker ports bind to `127.0.0.1`:
```yaml
ports:
  - "127.0.0.1:8090:8090"
  - "127.0.0.1:3100:3100"
  - "127.0.0.1:4533:4533"
```

This means only nginx (on the host) can reach them. Do NOT expose these on `0.0.0.0` — it would bypass SSL and the security headers.

## Rule D13: No `:latest` Tags — Pin Exact Versions

**Never use `:latest` (or any floating tag) in `docker-compose.yml` or any Dockerfile `FROM` line.** Always pin to an exact version number (e.g., `deluan/navidrome:0.63.2`, NOT `deluan/navidrome:latest`).

### Why

- **Reproducibility** — `:latest` means "whatever was most recently pushed." A `docker pull` today and a `docker pull` next week can produce different images, making bugs unreproducible and deployments non-deterministic.
- **Silent breakage** — a new `latest` can introduce breaking changes, CVEs, or config incompatibilities without any code change on your side.
- **Rollback safety** — if you need to roll back, you know exactly which version was running.

### Acceptable patterns

```yaml
# ✅ Correct — pinned to an exact version
image: deluan/navidrome:0.63.2
image: node:22.14.0-alpine
```

```yaml
# ❌ Wrong — floating tags
image: deluan/navidrome:latest
image: node:22-alpine        # minor/patch can still drift
image: postgres:16           # patch version can drift
```

### When upgrading

1. Look up the actual latest version tag on Docker Hub or the project's releases page
2. Update the pinned version in `docker-compose.yml`
3. Test with `docker compose up -d` before committing
