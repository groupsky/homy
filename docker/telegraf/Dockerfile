FROM telegraf:1.32.1-alpine

COPY load-env-files.sh /load-env-files.sh
COPY secure-entrypoint.sh /secure-entrypoint.sh

ENTRYPOINT ["/secure-entrypoint.sh"]
CMD ["telegraf"]
