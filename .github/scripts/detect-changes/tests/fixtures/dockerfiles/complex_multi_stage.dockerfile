# Complex multi-stage with multiple FROM stages
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS deps

WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM ghcr.io/groupsky/homy/alpine:3.19 AS runtime-base

RUN apk add --no-cache nodejs

FROM runtime-base AS final

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=2 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
