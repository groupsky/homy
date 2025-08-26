FROM node:22-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy source code
COPY index.js ./
COPY src/ ./src/

# Health check using wget
RUN apk add --no-cache wget

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node src/health-check.js || exit 1

CMD ["node", "index.js"]
