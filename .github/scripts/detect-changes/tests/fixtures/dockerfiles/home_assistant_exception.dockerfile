# Home Assistant image (allowed exception to GHCR-only policy)
FROM ghcr.io/home-assistant/home-assistant:2024.1.0

COPY configuration.yaml /config/

VOLUME /config

CMD ["python", "-m", "homeassistant", "--config", "/config"]
