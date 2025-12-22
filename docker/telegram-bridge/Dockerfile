FROM ghcr.io/groupsky/homy/node:22-alpine

RUN set -ex && \
    apk add --no-cache wget && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    adduser -h /usr/src/app -D -H node-app -u 1000 && \
    chown -R node-app:node-app /usr/src/app

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

COPY index.js ./
COPY src/ ./src/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

USER node-app

CMD ["node", "index.js"]
