#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node:20.20.0-alpine3.23 AS base

WORKDIR /usr/src/app

COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

# Install build dependencies for node-gyp and libftdi native compilation
RUN apk add --no-cache --virtual .build-deps \
    python3 \
    make \
    g++ \
    linux-headers \
    pkgconf \
    libftdi1-dev && \
    ln -s /usr/lib/libftdi1.so /usr/lib/libftdi.so && \
    export CXXFLAGS="$(pkg-config --cflags libftdi1)" && \
    export LDFLAGS="$(pkg-config --libs libftdi1)" && \
    npm ci --omit=dev && \
    cp -R node_modules prod_node_modules && \
    rm /usr/lib/libftdi.so && \
    apk del .build-deps

#### Stage RELEASE #####################################################################################################
FROM base AS release

ENV NODE_OPTIONS="--unhandled-rejections=strict"

# Install only runtime dependencies
RUN apk add --no-cache libftdi1 && \
    deluser --remove-home node 2>/dev/null || true && \
    delgroup node 2>/dev/null || true && \
    addgroup -g 1000 node-app && \
    adduser -D -u 1000 -G node-app node-app && \
    addgroup node-app dialout && \
    chown -R node-app:node-app /usr/src/app

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

USER node-app

ENTRYPOINT ["node", "index.js"]
