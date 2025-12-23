FROM node:18.20.8-alpine

RUN set -ex && \
    apk add --no-cache build-base && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    adduser -h /usr/src/app -D -H node-app -u 1000 && \
    chown -R node-app:node-app /usr/src/app

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

USER node-app

CMD ["npm", "start"]