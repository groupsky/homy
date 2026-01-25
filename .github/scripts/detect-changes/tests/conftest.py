"""
Shared pytest fixtures for all tests.

Provides common test fixtures:
- Sample Dockerfiles
- Mock docker-compose.yml content
- Mock base-images.yml configuration
- Temporary directory setup
"""

import pytest
from pathlib import Path


@pytest.fixture
def temp_repo(tmp_path):
    """Create a temporary repository structure for testing."""
    repo = tmp_path / "repo"
    repo.mkdir()

    # Create base directory structure
    (repo / "base-images").mkdir()
    (repo / "docker").mkdir()

    return repo


@pytest.fixture
def sample_dockerfile():
    """Sample Dockerfile content for testing."""
    return """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

HEALTHCHECK --interval=30s --timeout=3s \\
  CMD node healthcheck.js

CMD ["node", "server.js"]
"""


@pytest.fixture
def sample_base_images_config():
    """Sample base-images.yml configuration."""
    return """
images:
  - name: node
    versions:
      - "18.20.8-alpine"
      - "22-alpine"
    source: "node"

  - name: alpine
    versions:
      - "3.19"
      - "3.18"
    source: "alpine"
"""


@pytest.fixture
def sample_docker_compose():
    """Sample docker-compose.yml content."""
    return """
version: '3.8'

services:
  automations:
    build:
      context: ./docker/automations
      dockerfile: Dockerfile
    image: ghcr.io/groupsky/homy/automations:latest

  mqtt-influx:
    build:
      context: ./docker/mqtt-influx
      dockerfile: Dockerfile
    image: ghcr.io/groupsky/homy/mqtt-influx:latest
"""


# TODO: Add more shared fixtures as needed
