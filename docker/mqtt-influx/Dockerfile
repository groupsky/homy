#### Stage BASE ########################################################################################################
FROM node:18.3.0-alpine3.14 AS base

# Install tools, create app dir, add user and set rights
RUN set -ex && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    adduser -h /usr/src/app -D -H node-app -u 1000 && \
    addgroup node-app dialout && \
    chown -R node-app:node-app /usr/src/app

# Set work directory
WORKDIR /usr/src/app

# copy package.json and lock file
COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

# Install Build tools
RUN apk add --no-cache --virtual buildtools build-base linux-headers udev python3 && \
    npm ci --unsafe-perm --no-update-notifier --only=production && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

# Chown & Clean up
RUN chown -R node-app:node-app /usr/src/app && \
    rm -rf /tmp/*

COPY load-env-files.sh /load-env-files.sh
COPY secure-entrypoint.sh /secure-entrypoint.sh

USER node-app

ENTRYPOINT ["/secure-entrypoint.sh"]
CMD ["node", "index.js"]
