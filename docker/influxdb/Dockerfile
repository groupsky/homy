FROM influxdb:1.8.3-alpine

HEALTHCHECK --interval=1s --timeout=1s --retries=3 CMD wget localhost:8086/health -q -O - > /dev/null 2>&1
