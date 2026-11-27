FROM ghcr.io/groupsky/homy/mosquitto:2.0.23

COPY entrypoint.sh /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
# Setting ENTRYPOINT clears the base image's CMD, so set it again.
CMD ["/usr/sbin/mosquitto", "-c", "/mosquitto/config/mosquitto.conf"]

HEALTHCHECK --interval=30s --timeout=5s --retries=6 \
  CMD mosquitto_sub -i healthcheck -t '$SYS/#' -C 1 | grep -v Error || exit 1
