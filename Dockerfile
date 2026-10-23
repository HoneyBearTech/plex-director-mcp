# syntax=docker/dockerfile:1

# The builder must be the same Node line and Debian release as the runtime
# stage below: native add-ons (better-sqlite3, ssh2's cpu-features) are built
# here and loaded there, and a different Node ABI or libc only works by luck.
FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS backend-builder
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
# An empty data folder for the runtime stage to own (distroless has no shell to
# mkdir/chown with).
RUN mkdir -p /out/data

# Separate stage (no native compilation, no toolchain needed) so it builds
# independently of - and in parallel with - the backend.
FROM node:24-trixie-slim@sha256:43b9ba1142b8dcf33fa8f922ca1be85714adc444e0586c7cf7726daaeabc1bea AS frontend-builder
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Distroless has no shell, package manager, or other OS userland beyond the
# Node runtime itself - it's not just npm that's absent but most of the
# Debian packages (perl, util-linux, etc.) that showed up as CVEs on
# node:24-slim despite this app never using them.
FROM gcr.io/distroless/nodejs24-debian13@sha256:c23cc7262662efd642cd9c9d61783d10f600321f7bafdd37c8a82365ffaa2aa6 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# package.json must stay - Node needs its "type": "module" field to know
# dist/*.js should be parsed as ESM.
COPY package.json package-lock.json LICENSE ./
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/dist ./dist
COPY --from=frontend-builder /app/web/dist ./web/dist
# Owned by the user below. Docker copies this ownership into a named volume the
# first time it is mounted here, so a fresh volume works without a chown; a host
# folder (bind mount) still needs one: see docs/upgrading.md.
COPY --from=backend-builder --chown=65532:65532 /out/data ./data

# distroless's built-in "nonroot" user, by number so runAsNonRoot checks can
# verify it. Override with --user (e.g. to match a host folder's owner).
USER 65532:65532

EXPOSE 3000

# Proves to the official MCP registry that this image belongs to the
# server.json entry of the same name (see .github/workflows/ci.yml).
LABEL io.modelcontextprotocol.server.name="io.github.HoneyBearTech/plex-director-mcp"

# The runtime image has no shell, curl or wget, so the check is Node itself:
# GET /healthz (public, needs no login) on the port the dashboard listens on.
# start-period covers the first boot, when the SQLite schema is created.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# The base image's ENTRYPOINT is already the node binary, so CMD is just
# the script to run. The MCP server speaks stdio (run attached, e.g.
# `docker run -i --rm -p 3000:3000 --env-file .env <image>`), while the web
# UI is a normal HTTP server on WEB_PORT (default 3000).
CMD ["dist/index.js"]
