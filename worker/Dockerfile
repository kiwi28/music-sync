# -- Worker Dockerfile --
# Build context: project root (docker-compose context: .)
# This image bundles Node.js 22 + Python 3 + spotdl + yt-dlp + ffmpeg.
# spotdl's pip install pulls in yt-dlp as a dependency automatically.

FROM node:22-slim

# Install Python 3, ffmpeg, and spotdl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# spotdl installs yt-dlp as a dependency, so we get both from one pip install.
# --break-system-packages is needed on Debian Bookworm (PEP 668).
RUN pip3 install --break-system-packages --no-cache-dir spotdl

WORKDIR /app

# Install Node.js dependencies (pocketbase SDK only)
COPY worker/package.json ./
RUN npm install --omit=dev

# Copy worker source
COPY worker/src/ ./src/
COPY worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Verify tools are available
RUN spotdl --version && yt-dlp --version && ffmpeg -version

# spotdl config/cache dir — persists OAuth tokens across restarts
RUN mkdir -p /home/node/.spotdl && chown -R node:node /home/node

# Create music dirs ahead of volume mount (ownership set at runtime)
RUN mkdir -p /music/spotify /music/youtube_music

ENTRYPOINT ["/entrypoint.sh"]
