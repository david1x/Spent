# Spent in a container: the Next.js app plus the Chromium the bank scrapers drive.
# Data (database + encryption key) lives in /data; mount a volume there.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Build tools in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# The system Chromium from the runtime stage is used instead of Puppeteer's
# download, which also works on arm64 (Puppeteer ships no Linux arm64 Chrome).
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation tzdata ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    SPENT_DATA_DIR=/data \
    TZ=Asia/Jerusalem
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
# Migrations are read from disk when the database opens.
COPY --from=build --chown=node:node /app/src/server/db/migrations ./src/server/db/migrations
# Locked out of sign-in: docker exec spent node scripts/reset-sign-in.mjs
COPY --from=build --chown=node:node /app/scripts/reset-sign-in.mjs ./scripts/reset-sign-in.mjs
# A new named volume copies this folder's owner, so the app can write to it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4005
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4005/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "4005"]
