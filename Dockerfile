# syntax=docker/dockerfile:1.7
#
# Backend image. Build context = repo root:
#   docker build -t yieldvault-backend .
#
# Stages:
#   base    - Node.js runtime
#   build   - install, generate Prisma client, and compile
#   runtime - Node.js runtime with dist and production dependencies

ARG NODE_VERSION=22

# ---------- base ----------
FROM node:${NODE_VERSION}-alpine AS base
# Prisma's query engine needs openssl on alpine
RUN apk add --no-cache openssl
WORKDIR /app

# ---------- build ----------
FROM base AS build
COPY packages/api-schemas/package.json packages/api-schemas/package.json
COPY packages/api-schemas/package-lock.json packages/api-schemas/package-lock.json
COPY backend/package.json backend/package.json
COPY backend/package-lock.json backend/package-lock.json
RUN npm ci --prefix packages/api-schemas \
 && npm ci --prefix backend

COPY packages/api-schemas packages/api-schemas
COPY backend backend
RUN npm run build --prefix packages/api-schemas \
 && npm run prisma:generate --prefix backend \
 && npm run build --prefix backend

RUN mkdir -p /out \
 && cp -a backend/dist /out/dist \
 && cp -a backend/node_modules /out/node_modules \
 && cp -a backend/prisma /out/prisma

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
