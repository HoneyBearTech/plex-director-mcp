# syntax=docker/dockerfile:1

FROM node:26-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239 AS builder
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

# Distroless has no shell, package manager, or other OS userland beyond the
# Node runtime itself - it's not just npm that's absent but most of the
# Debian packages (perl, util-linux, etc.) that showed up as CVEs on
# node:24-slim despite this app never using them.
FROM gcr.io/distroless/nodejs24-debian12@sha256:61f4f4341db81820c24ce771b83d202eb6452076f58628cd536cc7d94a10978b AS runtime
WORKDIR /app
ENV NODE_ENV=production
# package.json must stay - Node needs its "type": "module" field to know
# dist/*.js should be parsed as ESM.
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The base image's ENTRYPOINT is already the node binary, so CMD is just
# the script to run. The MCP server speaks stdio, so it's meant to be run
# attached (e.g. `docker run -i --rm --env-file .env <image>`), not detached.
CMD ["dist/index.js"]
