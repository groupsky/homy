FROM ghcr.io/groupsky/homy/telegraf:1.37.0-alpine

COPY load-env-files.sh /load-env-files.sh
COPY secure-entrypoint.sh /secure-entrypoint.sh

ENTRYPOINT ["/secure-entrypoint.sh"]
CMD ["telegraf"]
