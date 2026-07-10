#!/bin/sh
set -e

# Sync migrations from image into the volume (won't overwrite existing)
cp -rn /pb_migrations_src/* /pb_data/pb_migrations/ 2>/dev/null || true

# Create superuser on first run if env vars are set
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
    --dir=/pb_data 2>/dev/null || true
fi

exec pocketbase serve --http=0.0.0.0:8090 --dir=/pb_data
