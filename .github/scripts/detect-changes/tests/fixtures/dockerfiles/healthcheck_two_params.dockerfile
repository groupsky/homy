# Dockerfile with HEALTHCHECK using only 2 parameters (based on mqtt-influx)
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

HEALTHCHECK --interval=30s --timeout=10s \
  CMD node healthcheck.js

CMD ["node", "index.js"]
