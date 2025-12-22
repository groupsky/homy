#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node-ubuntu:18.12.1 AS base

RUN set -ex && \
    mkdir -p /usr/src/app && \
    deluser --remove-home node && \
    useradd --home-dir /usr/src/app --no-create-home node-app --uid 1000 && \
    addgroup node-app dialout && \
    chown -R node-app:node-app /usr/src/app && \
    apt-get update && apt-get install -y \
      libftdi1 && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

RUN apt-get update && apt-get install -y \
    udev python3 \
    libftdi-dev && \
    rm -rf /var/lib/apt/lists/* && \
    npm ci --unsafe-perm --no-update-notifier --omit=dev && \
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

# Chown & Clean up
RUN chown -R node-app:node-app /usr/src/app && \
    rm -rf /tmp/*

#USER node-app

ENTRYPOINT ["node", "index.js"]
