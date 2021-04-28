FROM influxdb:2.0.5-alpine

COPY load-env-files.sh /load-env-files.sh
COPY secure-entrypoint.sh /secure-entrypoint.sh

ENTRYPOINT ["/secure-entrypoint.sh"]
CMD ["influxd"]

HEALTHCHECK --interval=1s --timeout=1s --retries=3 \
  CMD wget -U "healthcheck" localhost:8086/health -q -O - > /dev/null 2>&1
