FROM nodered/node-red:4.1.0-20

# Copy package.json to the WORKDIR so npm builds all
# of your added nodes modules for Node-RED
COPY package.json .
COPY package-lock.json .

RUN npm version && npm ci --unsafe-perm --no-update-notifier --no-fund --omit=dev
