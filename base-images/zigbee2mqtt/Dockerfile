FROM ghcr.io/koenkk/zigbee2mqtt:2.7.2

# Healthcheck using Node.js (already available in container)
# Checks if frontend web interface is responding
HEALTHCHECK --interval=60s --timeout=10s --start-period=120s --retries=5 \
  CMD node -e "require('http').get('http://localhost:8080/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
