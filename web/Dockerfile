# syntax=docker/dockerfile:1
# BoA web demo — build the Vite SPA and serve it statically on $PORT (Railway).
# NEXT_PUBLIC_RELAY_URL / VITE_* are read at BUILD time, so they must be present
# as build args. Railway passes service Variables to Dockerfile builds as args.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# the one mock<->live switch + the ENS service URL (all build-time for Vite)
ARG NEXT_PUBLIC_RELAY_URL=""
ARG VITE_ENS_API_BASE=""
ARG VITE_SEPOLIA_RPC_URL=""
ARG VITE_ROUTER_APP_URL=""
ENV NEXT_PUBLIC_RELAY_URL=$NEXT_PUBLIC_RELAY_URL \
    VITE_ENS_API_BASE=$VITE_ENS_API_BASE \
    VITE_SEPOLIA_RPC_URL=$VITE_SEPOLIA_RPC_URL \
    VITE_ROUTER_APP_URL=$VITE_ROUTER_APP_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN npm i -g serve@14
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
# SPA fallback (-s) so client routes resolve to index.html
CMD ["sh", "-c", "serve -s dist -l ${PORT:-8080}"]
