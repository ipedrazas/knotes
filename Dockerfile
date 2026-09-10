# ── Build ────────────────────────────────────────────────────────────────────
# Runs on the builder's own architecture even for arm64 images: the output is plain
# JS/CSS and the runtime dependencies have no native code, so it's the same for both.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app

# Dependencies first, so code changes don't re-install node_modules.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

# ── Run ──────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

LABEL org.opencontainers.image.title="knotes"
LABEL org.opencontainers.image.description="A shared, real-time notebook that keeps notes as markdown files"
LABEL org.opencontainers.image.source="https://github.com/ipedrazas/knotes"
LABEL org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Node runs the TypeScript server directly (type stripping), no compile step.
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared

RUN mkdir /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server/index.ts"]
