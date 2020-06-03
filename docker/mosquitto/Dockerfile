FROM eclipse-mosquitto:1.6.10

HEALTHCHECK CMD timeout -t 5 mosquitto_sub -t '$SYS/#' -C 1 | grep -v Error || exit 1
