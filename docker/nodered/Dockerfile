FROM nodered/node-red:3.1.15-18

# Copy package.json to the WORKDIR so npm builds all
# of your added nodes modules for Node-RED
COPY package.json .
COPY package-lock.json .

RUN npm version && npm ci --unsafe-perm --no-update-notifier --no-fund --omit=dev
