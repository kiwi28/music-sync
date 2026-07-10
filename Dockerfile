# ── Stage 1: Build ──
FROM node:22-alpine AS builder
WORKDIR /app

# install all deps (including devDeps needed for build like tailwindcss)
COPY package.json package-lock.json ./
RUN npm ci

# source + build
COPY . .
RUN npm run build

# ── Stage 2: Run ──
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup -g 1001 -S nodejs \
 && adduser -S nextjs -u 1001 \
 && chown -R nextjs:nodejs /app

# production deps only (fresh install, not copied from builder)
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
ENV NODE_ENV=production
EXPOSE 3100

CMD ["npm", "start"]
