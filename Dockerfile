# ── Stage 1: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

# install all deps (including devDeps needed for build like tailwindcss)
COPY package.json package-lock.json ./
RUN npm ci

# source + build (output: "standalone" produces .next/standalone/)
COPY . .
RUN npm run build

# ── Stage 2: Run ──
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001 \
 && chown -R nextjs:nodejs /app

# Standalone output: the server is self-contained with only production deps.
# No npm ci needed — the standalone build already includes node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static files live outside the standalone dir — copy them into place.
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
ENV NODE_ENV=production
EXPOSE 3100

CMD ["node", "server.js"]
