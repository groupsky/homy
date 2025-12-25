FROM ghcr.io/groupsky/homy/mosquitto:2.0.22

HEALTHCHECK --interval=30s --timeout=5s --retries=6 \
  CMD mosquitto_sub -i healthcheck -t '$SYS/#' -C 1 | grep -v Error || exit 1
