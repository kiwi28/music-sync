# -- Worker Dockerfile --
# Build context: project root (docker-compose context: .)
# This image bundles Node.js 22 + Python 3 + spotdl + yt-dlp + ffmpeg.
# spotdl's pip install pulls in yt-dlp as a dependency automatically.

FROM node:22-slim

# Install Python 3, ffmpeg, spotdl, and curl (for deno install)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# spotdl installs yt-dlp as a dependency, so we get both from one pip install.
# --break-system-packages is needed on Debian Bookworm (PEP 668).
RUN pip3 install --break-system-packages --no-cache-dir spotdl

# Install deno — required by yt-dlp to execute JavaScript challenges
# that YouTube serves for bot detection. Without a JS runtime, certain
# videos fail with "No supported JavaScript runtime could be found".
RUN curl -fsSL https://github.com/denoland/deno/releases/latest/download/deno-x86_64-unknown-linux-gnu.zip -o /tmp/deno.zip \
    && unzip -o /tmp/deno.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip \
    && deno --version

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
