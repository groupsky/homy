FROM ghcr.io/groupsky/homy/zigbee2mqtt:2.7.2

# Add custom entrypoint wrapper to support _FILE suffix for Docker secrets
COPY docker-entrypoint-wrapper.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint-wrapper.sh

ENTRYPOINT ["/usr/local/bin/docker-entrypoint-wrapper.sh"]
CMD ["npm", "start"]
