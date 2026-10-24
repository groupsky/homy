FROM ghcr.io/koenkk/zigbee2mqtt:2.14.2

HEALTHCHECK CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1
