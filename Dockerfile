# ── Stage 1: build the React client ──────────────────────────────────────────
FROM node:24-alpine AS client
WORKDIR /build
COPY client/package.json client/package-lock.json ./client/
RUN npm --prefix client ci
COPY shared ./shared
COPY docs ./docs
COPY client ./client
RUN npm --prefix client run build

# ── Stage 2: server ──────────────────────────────────────────────────────────
# Node 24 has the built-in node:sqlite module, so there are no native dependencies.
FROM node:24-alpine
RUN apk add --no-cache tzdata
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data TZ=Asia/Bangkok
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY --from=client /build/client/dist ./client/dist
RUN mkdir -p /app/data/uploads && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/me >/dev/null || exit 1
CMD ["node", "server/server.js"]
