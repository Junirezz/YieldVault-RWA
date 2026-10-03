# syntax=docker/dockerfile:1.7
#
# Backend image. Build context = repo root:
#   docker build -t yieldvault-backend .
#
# Stages:
#   base    - node + pinned pnpm
#   fetch   - manifests only -> `pnpm fetch` (layer only busts when the lockfile changes)
#   build   - install offline, generate Prisma client, compile, `pnpm deploy --prod`
#   runtime - node:20-alpine with only dist + production node_modules

ARG NODE_VERSION=20
ARG PNPM_VERSION=9.12.0

# ---------- base ----------
FROM node:${NODE_VERSION}-alpine AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
# Prisma's query engine needs openssl on alpine
RUN apk add --no-cache openssl
WORKDIR /app

# ---------- fetch ----------
FROM base AS fetch
# Only files that affect dependency resolution, so this layer is cached
# until the lockfile / manifests change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch

# ---------- build ----------
FROM fetch AS build
COPY backend backend
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter backend...

RUN pnpm --filter backend exec prisma generate \
 && pnpm --filter backend run build

# Production-only, self-contained copy of the backend package
# (requires "dist" to be covered by backend/package.json "files", or no "files" field)
RUN pnpm --filter backend deploy --prod /out
# Regenerate the Prisma client inside the deployed tree
# (requires `prisma` to be in backend "dependencies", not only devDependencies)
RUN cd /out && ./node_modules/.bin/prisma generate

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
# Adjust to the real entrypoint emitted by the backend build
CMD ["node", "dist/index.js"]
