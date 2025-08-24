FROM node:22-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY index.js ./
COPY src/ ./src/

EXPOSE 3000

CMD ["node", "index.js"]
