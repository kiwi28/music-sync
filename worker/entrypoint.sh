#!/bin/sh
# Set spotipy username so spotdl finds our OAuth cache file.
# The worker's spotify-token.js writes ~/.spotdl/.spotipy-cache-spotify.
export SPOTIPY_CLIENT_USERNAME=spotify

# Generate spotdl config from env vars for client credentials.
if [ -n "$SPOTIFY_CLIENT_ID" ] && [ -n "$SPOTIFY_CLIENT_SECRET" ]; then
  mkdir -p /home/node/.spotdl
  cat > /home/node/.spotdl/config.json << EOF
{
    "client_id": "$SPOTIFY_CLIENT_ID",
    "client_secret": "$SPOTIFY_CLIENT_SECRET",
    "user_auth": true,
    "headless": true,
    "auth_token": null,
    "no_cache": false
}
EOF
  echo "[entrypoint] spotdl config written"
else
  echo "[entrypoint] SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET not set — Spotify sync needs OAuth setup in Settings"
fi

# Log cookie configuration
if [ -n "$YOUTUBE_COOKIES" ] && [ -f "$YOUTUBE_COOKIES" ]; then
  echo "[entrypoint] YouTube cookies configured: $YOUTUBE_COOKIES"
elif [ -n "$YOUTUBE_COOKIES" ]; then
  echo "[entrypoint] WARNING: YOUTUBE_COOKIES is set but file not found: $YOUTUBE_COOKIES"
else
  echo "[entrypoint] No YouTube cookies configured — age-restricted tracks will be skipped"
fi

exec node src/worker.js
