"""
Shared pytest fixtures for all tests.

Provides common test fixtures:
- Sample Dockerfiles
- Mock docker-compose.yml content
- Mock base-images.yml configuration
- Temporary directory setup
"""

import sys
from pathlib import Path

# Add lib directory to Python path for imports
lib_path = Path(__file__).parent.parent / "lib"
sys.path.insert(0, str(lib_path))

import pytest


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


@pytest.fixture
def base_images_dir(temp_repo):
    """Create base-images directory structure for testing."""
    base_dir = temp_repo / "base-images"
    base_dir.mkdir(exist_ok=True)
    return base_dir


@pytest.fixture
def sample_base_dockerfiles():
    """Sample base image Dockerfiles for testing."""
    return {
        'node-18-alpine': 'FROM node:18.20.8-alpine3.21\n',
        'node-22-alpine': 'FROM node:22.13.1-alpine3.21\n',
        'grafana': 'FROM grafana/grafana:9.5.21\n',
        'influxdb': 'FROM influxdb:1.8.10\n',
        'mosquitto': 'FROM eclipse-mosquitto:2.0.20\n',
        'alpine': 'FROM alpine:3.22.1\n',
        'node-ubuntu': 'FROM node:18.20.5-bullseye\n',
    }


# TODO: Add more shared fixtures as needed
