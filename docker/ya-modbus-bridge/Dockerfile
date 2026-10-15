#### Stage BASE ########################################################################################################
# Node 22: the bridge's engines exclude Node 26.4 and newer (ya-modbus#507).
# ya-modbus has no image of its own yet (ya-modbus#623).
FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23 AS base

# Create app dir, add user and set rights. The user is in dialout, the group
# of the serial ports.
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

# No build tools: serialport ships a prebuilt binding for musl on x64 and arm64
RUN npm ci --no-update-notifier --omit=dev && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

COPY --from=build /usr/src/app/prod_node_modules ./node_modules

# Chown & Clean up
RUN chown -R node-app:node-app /usr/src/app && \
    rm -rf /tmp/*

USER node-app

# The bridge stops cleanly on SIGTERM by itself.
ENTRYPOINT ["node", "node_modules/@ya-modbus/mqtt-bridge/dist/esm/bin/ya-modbus-bridge.js"]
CMD ["run", "--config", "/etc/ya-modbus/config.json"]
