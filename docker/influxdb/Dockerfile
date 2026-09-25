FROM ghcr.io/groupsky/homy/influxdb:1.12.4-alpine

COPY load-env-files.sh /load-env-files.sh
COPY secure-entrypoint.sh /secure-entrypoint.sh

ENTRYPOINT ["/secure-entrypoint.sh"]
CMD ["influxd"]

# Opening the shards takes about 2 minutes on routy (#1607); failures inside
# the start period do not count, so it is not marked unhealthy while loading.
HEALTHCHECK --interval=1s --timeout=1s --start-period=300s --retries=3 \
  CMD wget -U "healthcheck" localhost:8086/health -q -O - > /dev/null 2>&1
