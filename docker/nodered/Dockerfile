FROM nodered/node-red:3.0.2-16

# Copy package.json to the WORKDIR so npm builds all
# of your added nodes modules for Node-RED
COPY package.json .
COPY package-lock.json .

RUN npm install --unsafe-perm --no-update-notifier --no-fund --only=production
