# Multi-stage build with HEALTHCHECK (based on automations service)
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

FROM base AS build

RUN npm ci
COPY . .
RUN npm run build

FROM base AS release

COPY --from=build /app/dist ./dist
COPY config ./config

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node healthcheck.js

CMD ["node", "dist/index.js"]
