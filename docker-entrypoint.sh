#!/bin/sh
set -e

# Copy migrations from image to volume (only new ones, don't overwrite)
mkdir -p /pb_data/pb_migrations
echo "=== Copying migrations ==="
ls -la /pb_migrations_src/
cp -rnv /pb_migrations_src/* /pb_data/pb_migrations/
echo "=== Migrations in volume ==="
ls -la /pb_data/pb_migrations/

# Create superuser on first run if env vars are set
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
    --dir=/pb_data 2>/dev/null || true
fi

exec pocketbase serve --http=0.0.0.0:8090 --dir=/pb_data
