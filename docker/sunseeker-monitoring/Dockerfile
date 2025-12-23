FROM node:22-alpine

RUN set -ex && \
    apk add --no-cache build-base && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    adduser -h /usr/src/app -D -H node-app -u 1000 && \
    chown -R node-app:node-app /usr/src/app

WORKDIR /usr/src/app

COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY index.js ./
COPY src/ ./src/

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node src/health-check.js || exit 1

USER node-app

CMD ["node", "index.js"]
