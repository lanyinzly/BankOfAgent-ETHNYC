# syntax=docker/dockerfile:1
# BoA Relay (shim) — production image for Railway / any container host.
# No build step: Node 22 (>=22.18) runs the TypeScript entry directly via native
# type stripping. Build context is this directory (relay/).
FROM node:22-alpine

WORKDIR /app

# Runtime deps only (devDeps are typescript/@types, not needed at runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# App source
COPY . .

ENV NODE_ENV=production
# Railway injects PORT at runtime; this is just the local default.
ENV PORT=8787
EXPOSE 8787

# Healthcheck hits the relay's /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1

CMD ["node", "index.ts"]
