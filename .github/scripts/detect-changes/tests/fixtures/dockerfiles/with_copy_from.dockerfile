# Multi-stage with external COPY --from (based on real patterns)
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /app

FROM base AS build

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM base AS release

# External COPY --from (dependency on external image)
COPY --from=ghcr.io/groupsky/homy/alpine:3.19 /etc/ssl/certs /etc/ssl/certs

# Internal COPY --from (no external dependency)
COPY --from=build /app/dist ./dist

CMD ["node", "dist/index.js"]
