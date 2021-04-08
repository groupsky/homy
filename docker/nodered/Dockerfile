#### Stage BASE ########################################################################################################
FROM node:14.16.1-alpine AS base

# Install tools, create Node-RED app and data dir, add user and set rights
RUN set -ex && \
    apk add --no-cache \
        bash \
        tzdata \
        iputils \
        curl \
        nano \
        git \
        openssh-client && \
    mkdir -p /usr/src/node-red /data && \
    deluser --remove-home node && \
    adduser -h /usr/src/node-red -D -H node-red -u 1000 && \
    chown -R node-red:node-red /data && \
    chown -R node-red:node-red /usr/src/node-red

# Set work directory
WORKDIR /usr/src/node-red

# Copy scripts
COPY scripts/*.sh /tmp/

# package.json contains Node-RED NPM module and node dependencies
COPY package.json .
COPY package-lock.json .

#### Stage BUILD #######################################################################################################
FROM base AS build

# Install Build tools
RUN apk add --no-cache --virtual buildtools build-base linux-headers udev python && \
    npm ci --unsafe-perm --no-update-notifier --only=production && \
    /tmp/remove_native_gpio.sh && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE
ARG NODE_RED_VERSION

COPY --from=build /usr/src/node-red/prod_node_modules ./node_modules

# Chown, install devtools & Clean up
RUN chown -R node-red:node-red /usr/src/node-red && \
    /tmp/install_devtools.sh && \
    rm -rf /tmp/*

USER node-red

# Env variables
ENV NODE_RED_VERSION=$NODE_RED_VERSION \
    NODE_PATH=/usr/src/node-red/node_modules:/data/node_modules \
    FLOWS=flows.json

# ENV NODE_RED_ENABLE_SAFE_MODE=true    # Uncomment to enable safe start mode (flows not running)
# ENV NODE_RED_ENABLE_PROJECTS=true     # Uncomment to enable projects option

# User configuration directory volume
VOLUME ["/data"]

# Expose the listening port of node-red
EXPOSE 1880

# Add a healthcheck (default every 30 secs)
HEALTHCHECK CMD curl http://localhost:1880/ || exit 1

ENTRYPOINT ["npm", "start", "--", "--userDir", "/data"]
