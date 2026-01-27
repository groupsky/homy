"""
Docker healthcheck parsing and validation.

Parses and validates HEALTHCHECK instructions from Dockerfiles:
- Extracts healthcheck configuration
- Validates interval, timeout, retries
- Converts to docker-compose format if needed
"""

# TODO: Implement healthcheck parser
