# syntax=docker/dockerfile:1

FROM node:24-slim AS builder
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

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The base image bundles its own npm/npx/corepack install for building with,
# which we don't need at runtime (we just run `node dist/index.js`) - and its
# vendored dependencies are a real source of flagged CVEs that have nothing
# to do with this app.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The MCP server speaks stdio, so it's meant to be run attached
# (e.g. `docker run -i --rm --env-file .env <image>`), not detached.
CMD ["node", "dist/index.js"]
