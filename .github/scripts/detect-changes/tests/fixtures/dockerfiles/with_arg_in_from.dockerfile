# Invalid Dockerfile with ARG in FROM (should be rejected per policy)
ARG NODE_VERSION=18.20.8

FROM ghcr.io/groupsky/homy/node:${NODE_VERSION}-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

CMD ["node", "index.js"]
