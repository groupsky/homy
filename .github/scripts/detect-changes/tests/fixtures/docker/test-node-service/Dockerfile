FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS build
RUN npm ci

FROM base AS RELEASE
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .
CMD ["node", "index.js"]
