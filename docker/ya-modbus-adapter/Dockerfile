#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node:24.13.0-alpine3.23 AS base

# Create app dir, add user and set rights. The service runs as uid 1000, the
# owner of the raw data directory it writes to.
RUN set -ex && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    adduser -h /usr/src/app -D -H node-app -u 1000 && \
    chown -R node-app:node-app /usr/src/app

# Set work directory
WORKDIR /usr/src/app

# copy package.json and lock file
COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

# No native dependencies, so no build tools
RUN npm ci --no-update-notifier --omit=dev && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

# Chown & Clean up
RUN chown -R node-app:node-app /usr/src/app && \
    rm -rf /tmp/*

USER node-app

ENTRYPOINT ["node", "index.js"]
