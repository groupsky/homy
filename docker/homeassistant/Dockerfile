FROM ghcr.io/home-assistant/home-assistant:2026.8.3

# Start-up (integrations, recorder schema migrations) takes minutes; failures
# inside the start period do not count (#1607)
HEALTHCHECK --start-period=180s CMD curl --fail http://localhost:8123/ || exit 1
