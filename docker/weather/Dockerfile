FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.23

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

USER node

CMD ["node", "index.js"]
