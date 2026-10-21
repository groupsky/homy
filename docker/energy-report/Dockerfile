FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.23

WORKDIR /app

# No npm dependencies: the service uses only Node's own modules and fetch.
COPY package.json index.js ./
COPY src ./src

USER node

CMD ["node", "index.js"]
