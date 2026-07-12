#!/bin/sh
set -e

# Copy migrations from image to volume
# Uses content comparison (not just filename) so fixed migrations in a new image
# actually replace stale/broken copies left in the persistent volume.
mkdir -p /pb_data/pb_migrations
echo "=== Copying migrations ==="
ls -la /pb_migrations_src/

for src in /pb_migrations_src/*.js; do
  [ -f "$src" ] || continue
  dest="/pb_data/pb_migrations/${src##*/}"
  if [ -f "$dest" ] && cmp -s "$src" "$dest"; then
    echo "  unchanged: ${src##*/}"
  else
    cp -v "$src" "$dest"
  fi
done

echo "=== Migrations in volume ==="
ls -la /pb_data/pb_migrations/

# Create superuser on first run if env vars are set
if [ -n "$PB_SUPERUSER_EMAIL" ] && [ -n "$PB_SUPERUSER_PASSWORD" ]; then
  pocketbase superuser upsert "$PB_SUPERUSER_EMAIL" "$PB_SUPERUSER_PASSWORD" \
    --dir=/pb_data 2>/dev/null || true
fi

exec pocketbase serve --http=0.0.0.0:8090 --dir=/pb_data
