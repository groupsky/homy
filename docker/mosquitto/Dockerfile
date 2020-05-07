FROM eclipse-mosquitto:1.6.9

HEALTHCHECK CMD timeout -t 5 mosquitto_sub -t '$SYS/#' -C 1 | grep -v Error || exit 1
