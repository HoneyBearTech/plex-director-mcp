# syntax=docker/dockerfile:1

FROM node:22-slim AS builder
WORKDIR /app
# better-sqlite3 and ssh2's optional cpu-features package compile native
# bindings at install time and need a toolchain to do it.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --outDir dist --rootDir src
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The MCP server speaks stdio, so it's meant to be run attached
# (e.g. `docker run -i --rm --env-file .env <image>`), not detached.
CMD ["node", "dist/index.js"]
