# syntax=docker/dockerfile:1.7-labs

# -------------------------------------------------------------
# Stage 1: Build & Dependencies
# -------------------------------------------------------------
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS builder
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci

COPY tsconfig*.json ./
COPY apps/ ./apps/
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Dependencies
# -------------------------------------------------------------
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS prod-deps
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci --omit=dev

# -------------------------------------------------------------
# Stage 3: Minimal Production Runtime (DEV-02)
# -------------------------------------------------------------
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8 AS runner
WORKDIR /app

ENV NODE_ENV=production

# Eliminar npm global y yarn para que Trivy no reporte CVEs de herramientas de build en prod
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /opt/yarn*

ARG GIT_SHA="unknown"
ARG BUILT_AT="unknown"
ENV GIT_SHA=${GIT_SHA}
ENV BUILT_AT=${BUILT_AT}

USER node

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=prod-deps /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/apps/api/dist ./dist
COPY --chown=node:node apps/api/migrations ./dist/migrations

EXPOSE 8080 9090

CMD ["node", "dist/api.js"]