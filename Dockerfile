# syntax=docker/dockerfile:1

FROM node:26-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239 AS backend-builder
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

# Separate stage (no native compilation, no toolchain needed) so it builds
# independently of - and in parallel with - the backend.
FROM node:26-slim@sha256:14bf3eac4bf209d906d3c41256597d3ab1f926b2e93a79e9bdfe1efd32454239 AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

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
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/web/dist ./web/dist

EXPOSE 3000

# The base image's ENTRYPOINT is already the node binary, so CMD is just
# the script to run. The MCP server speaks stdio (run attached, e.g.
# `docker run -i --rm -p 3000:3000 --env-file .env <image>`), while the web
# UI is a normal HTTP server on WEB_PORT (default 3000).
CMD ["dist/index.js"]
