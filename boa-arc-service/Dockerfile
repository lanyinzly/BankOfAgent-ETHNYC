# syntax=docker/dockerfile:1
# BoA × Arc — one image, two entrypoints:
#   app service  : node index.ts   (default CMD)
#   relay service: node relay.ts   (override the start command in Railway settings)
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1
CMD ["node", "index.ts"]
