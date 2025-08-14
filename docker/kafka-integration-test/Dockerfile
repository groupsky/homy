FROM node:18.3.0-alpine3.14

# Install additional tools needed for integration testing
RUN apk add --no-cache curl bash

# Create app directory
WORKDIR /usr/src/app

# Copy package.json first for better Docker layer caching
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy test files
COPY . .

# Create a non-root user
RUN adduser -D -s /bin/sh testuser && \
    chown -R testuser:testuser /usr/src/app

USER testuser

# Default command
CMD ["npm", "run", "test:all"]