# Dockerfile with non-GHCR base image (should be flagged)
FROM node:18.20.8-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

CMD ["node", "index.js"]
