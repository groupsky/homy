"""
Test suite for dockerfile_parser module.

This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
for the dockerfile_parser module BEFORE implementation. All tests will initially FAIL (red phase)
until the implementation is complete.

The dockerfile_parser module is responsible for:
1. Parsing multi-stage Dockerfiles and extracting base images
2. Detecting HEALTHCHECK instructions and parameters
3. Validating Dockerfile patterns (e.g., no ARG in FROM)
4. Extracting external images from COPY --from statements
5. Parsing base image Dockerfiles to extract upstream images and versions
"""

import pytest
from pathlib import Path


class TestParseMultiStageDockerfile:
    """Test extraction of FROM lines from multi-stage Dockerfiles."""

    def test_single_stage_dockerfile(self):
        """Should extract base image from single-stage Dockerfile."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .
CMD ["node", "index.js"]
"""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert len(result) == 1
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result[0]['stage'] is None  # No stage name

    def test_multi_stage_dockerfile(self):
        """Should extract all FROM lines from multi-stage build."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS build

RUN npm ci --omit=dev

FROM base AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .
CMD ["node", "index.js"]
"""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert len(result) == 3
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result[0]['stage'] == 'base'
        assert result[1]['image'] == 'base'
        assert result[1]['stage'] == 'build'
        assert result[2]['image'] == 'base'
        assert result[2]['stage'] == 'RELEASE'

    def test_dockerfile_with_comments(self):
        """Should ignore comments when parsing FROM lines."""
        dockerfile_content = """
# This is a comment
# FROM commented:out

FROM ghcr.io/groupsky/homy/alpine:3.22.1 AS base

# Another comment
RUN apk add --no-cache curl
"""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert len(result) == 1
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/alpine:3.22.1'

    def test_dockerfile_with_platform_specification(self):
        """Should handle FROM lines with --platform flag."""
        dockerfile_content = """
FROM --platform=linux/amd64 ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
"""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert len(result) == 1
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result[0]['stage'] == 'base'
        assert result[0]['platform'] == 'linux/amd64'


class TestExtractFinalStageBase:
    """Test extraction of the final stage base image."""

    def test_single_stage_returns_that_image(self):
        """Should return the base image from single-stage Dockerfile."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/grafana:9.5.21

COPY grafana.ini /etc/grafana/grafana.ini
"""
        from dockerfile_parser import extract_final_stage_base

        result = extract_final_stage_base(dockerfile_content)

        assert result == 'ghcr.io/groupsky/homy/grafana:9.5.21'

    def test_multi_stage_returns_last_external_image(self):
        """Should return the base image from the final stage in multi-stage build."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app

FROM base AS build

RUN npm ci

FROM base AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
"""
        from dockerfile_parser import extract_final_stage_base

        result = extract_final_stage_base(dockerfile_content)

        # Final stage is RELEASE which uses "base" (internal stage)
        # So the final external base is from the "base" stage
        assert result == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'

    def test_resolves_internal_stage_references(self):
        """Should follow internal stage references to find the ultimate external base."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/alpine:3.22.1 AS stage1

FROM stage1 AS stage2

FROM stage2 AS stage3

FROM stage3 AS final
"""
        from dockerfile_parser import extract_final_stage_base

        result = extract_final_stage_base(dockerfile_content)

        # All stages chain back to the alpine image
        assert result == 'ghcr.io/groupsky/homy/alpine:3.22.1'


class TestDetectHealthcheckPresence:
    """Test detection of HEALTHCHECK instruction in Dockerfiles."""

    def test_dockerfile_with_healthcheck(self):
        """Should return True if HEALTHCHECK exists in final stage."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD node health-check.js

CMD ["node", "index.js"]
"""
        from dockerfile_parser import has_healthcheck

        assert has_healthcheck(dockerfile_content) is True

    def test_dockerfile_without_healthcheck(self):
        """Should return False if no HEALTHCHECK exists."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .

CMD ["node", "index.js"]
"""
        from dockerfile_parser import has_healthcheck

        assert has_healthcheck(dockerfile_content) is False

    def test_healthcheck_in_non_final_stage_ignored(self):
        """Should only detect HEALTHCHECK in the final stage."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

HEALTHCHECK CMD echo "healthy"

FROM base AS RELEASE

# No healthcheck in final stage
CMD ["node", "index.js"]
"""
        from dockerfile_parser import has_healthcheck

        # Only final stage matters - this should return False
        assert has_healthcheck(dockerfile_content) is False

    def test_healthcheck_disabled(self):
        """Should detect HEALTHCHECK NONE as explicitly disabled."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/grafana:9.5.21

HEALTHCHECK NONE

CMD ["grafana-server"]
"""
        from dockerfile_parser import has_healthcheck

        result = has_healthcheck(dockerfile_content)

        # HEALTHCHECK NONE explicitly disables health checks
        assert result is False


class TestParseHealthcheckParameters:
    """Test extraction of HEALTHCHECK parameters."""

    def test_healthcheck_with_all_parameters(self):
        """Should extract all 4 parameters: interval, timeout, start-period, retries."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD node health-check.js
"""
        from dockerfile_parser import parse_healthcheck_params

        result = parse_healthcheck_params(dockerfile_content)

        assert result is not None
        assert result['interval'] == '30s'
        assert result['timeout'] == '10s'
        assert result['start_period'] == '5s'
        assert result['retries'] == '3'
        assert result['cmd'] == 'node health-check.js'

    def test_healthcheck_with_missing_parameters(self):
        """Should handle missing optional parameters with defaults."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/mosquitto:2.0

HEALTHCHECK --interval=30s --timeout=5s --retries=6 \\
  CMD mosquitto_sub -t '$$SYS/#' -C 1 | grep -q version
"""
        from dockerfile_parser import parse_healthcheck_params

        result = parse_healthcheck_params(dockerfile_content)

        assert result is not None
        assert result['interval'] == '30s'
        assert result['timeout'] == '5s'
        assert result['retries'] == '6'
        # start_period should use default or be None
        assert result.get('start_period') in [None, '0s']

    def test_healthcheck_minimal_format(self):
        """Should parse minimal HEALTHCHECK without optional parameters."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/homeassistant:latest

HEALTHCHECK CMD curl --fail http://localhost:8123/ || exit 1
"""
        from dockerfile_parser import parse_healthcheck_params

        result = parse_healthcheck_params(dockerfile_content)

        assert result is not None
        assert result['cmd'] == 'curl --fail http://localhost:8123/ || exit 1'
        # Should have defaults for missing parameters
        assert 'interval' in result or result['interval'] is None
        assert 'timeout' in result or result['timeout'] is None

    def test_no_healthcheck_returns_none(self):
        """Should return None when no HEALTHCHECK exists."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

CMD ["node", "index.js"]
"""
        from dockerfile_parser import parse_healthcheck_params

        result = parse_healthcheck_params(dockerfile_content)

        assert result is None


class TestDetectCopyFromExternal:
    """Test extraction of external images from COPY --from statements."""

    def test_copy_from_with_external_image(self):
        """Should extract external images from COPY --from=image:tag."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/alpine:3.22.1

COPY --from=ghcr.io/groupsky/homy/node:18.20.8-alpine /usr/local/bin/node /usr/local/bin/

CMD ["node", "--version"]
"""
        from dockerfile_parser import extract_copy_from_external

        result = extract_copy_from_external(dockerfile_content)

        assert len(result) == 1
        assert 'ghcr.io/groupsky/homy/node:18.20.8-alpine' in result

    def test_copy_from_internal_stage_ignored(self):
        """Should not include internal stage names in COPY --from."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS build

RUN npm ci

FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
"""
        from dockerfile_parser import extract_copy_from_external

        result = extract_copy_from_external(dockerfile_content)

        # "build" is an internal stage, should not be in results
        assert len(result) == 0

    def test_multiple_copy_from_external(self):
        """Should extract multiple unique external images."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/alpine:3.22.1

COPY --from=ghcr.io/groupsky/homy/node:18.20.8-alpine /usr/local/bin/node /usr/local/bin/
COPY --from=ghcr.io/groupsky/homy/python:3.11-alpine /usr/local/bin/python /usr/local/bin/
COPY --from=ghcr.io/groupsky/homy/node:18.20.8-alpine /usr/local/lib/node_modules /usr/local/lib/
"""
        from dockerfile_parser import extract_copy_from_external

        result = extract_copy_from_external(dockerfile_content)

        # Should deduplicate the node image
        assert len(result) == 2
        assert 'ghcr.io/groupsky/homy/node:18.20.8-alpine' in result
        assert 'ghcr.io/groupsky/homy/python:3.11-alpine' in result

    def test_copy_without_from_ignored(self):
        """Should ignore COPY statements without --from flag."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

COPY package*.json ./
COPY . .
"""
        from dockerfile_parser import extract_copy_from_external

        result = extract_copy_from_external(dockerfile_content)

        assert len(result) == 0


class TestValidateNoArgInFrom:
    """Test validation that FROM lines don't use ARG variables."""

    def test_from_with_fixed_tags_passes(self):
        """Should pass when FROM uses fixed image tags."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
"""
        from dockerfile_parser import validate_no_arg_in_from

        # Should not raise ValidationError
        validate_no_arg_in_from(dockerfile_content)

    def test_from_with_arg_variable_fails(self):
        """Should raise ValidationError when ARG variable in FROM."""
        dockerfile_content = """
ARG NODE_VERSION=18.20.8

FROM ghcr.io/groupsky/homy/node:${NODE_VERSION}-alpine AS base

WORKDIR /usr/src/app
"""
        from dockerfile_parser import validate_no_arg_in_from, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_no_arg_in_from(dockerfile_content)

        assert 'ARG' in str(exc_info.value)
        assert 'FROM' in str(exc_info.value)

    def test_from_with_dollar_sign_in_image_name_fails(self):
        """Should detect variable substitution patterns in FROM."""
        dockerfile_content = """
FROM node:$VERSION

WORKDIR /app
"""
        from dockerfile_parser import validate_no_arg_in_from, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_no_arg_in_from(dockerfile_content)

        assert 'variable' in str(exc_info.value).lower() or 'ARG' in str(exc_info.value)

    def test_arg_used_elsewhere_is_allowed(self):
        """Should allow ARG when not used in FROM line."""
        dockerfile_content = """
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

ARG BUILD_DATE
LABEL build_date=${BUILD_DATE}

WORKDIR /usr/src/app
"""
        from dockerfile_parser import validate_no_arg_in_from

        # Should not raise ValidationError
        validate_no_arg_in_from(dockerfile_content)


class TestParseBaseImageDockerfile:
    """Test parsing base image Dockerfiles to extract upstream image and version."""

    def test_simple_base_image_dockerfile(self):
        """Should extract upstream image from base image Dockerfile."""
        # This is the typical pattern for base-images/ directory
        dockerfile_content = """
FROM node:18.20.8-alpine3.21
"""
        from dockerfile_parser import parse_base_image_dockerfile

        result = parse_base_image_dockerfile(dockerfile_content)

        assert result is not None
        assert result['upstream_image'] == 'node:18.20.8-alpine3.21'
        assert result['image_name'] == 'node'
        assert result['version_tag'] == '18.20.8-alpine3.21'

    def test_base_image_with_registry(self):
        """Should handle upstream images with registry prefix."""
        dockerfile_content = """
FROM docker.io/grafana/grafana:9.5.21
"""
        from dockerfile_parser import parse_base_image_dockerfile

        result = parse_base_image_dockerfile(dockerfile_content)

        assert result is not None
        assert result['upstream_image'] == 'docker.io/grafana/grafana:9.5.21'
        assert result['image_name'] == 'grafana/grafana'
        assert result['version_tag'] == '9.5.21'

    def test_base_image_without_version_tag(self):
        """Should handle images without explicit version tag."""
        dockerfile_content = """
FROM alpine
"""
        from dockerfile_parser import parse_base_image_dockerfile

        result = parse_base_image_dockerfile(dockerfile_content)

        assert result is not None
        assert result['upstream_image'] == 'alpine'
        assert result['image_name'] == 'alpine'
        # Version tag should be None or 'latest'
        assert result['version_tag'] in [None, 'latest']

    def test_multi_stage_base_image_uses_first_from(self):
        """Should extract from first FROM line in multi-stage base image."""
        dockerfile_content = """
FROM influxdb:1.8.10 AS base

RUN apt-get update

FROM base AS final

HEALTHCHECK --interval=1s --timeout=1s --retries=3 \\
  CMD influx -execute 'SHOW DATABASES'
"""
        from dockerfile_parser import parse_base_image_dockerfile

        result = parse_base_image_dockerfile(dockerfile_content)

        # Should use the first external FROM
        assert result is not None
        assert result['upstream_image'] == 'influxdb:1.8.10'
        assert result['image_name'] == 'influxdb'
        assert result['version_tag'] == '1.8.10'


class TestDockerfileParserEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_dockerfile_content(self):
        """Should handle empty Dockerfile content gracefully."""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines("")

        assert result == []

    def test_dockerfile_with_only_comments(self):
        """Should handle Dockerfile with only comments."""
        dockerfile_content = """
# Comment 1
# Comment 2
# Comment 3
"""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert result == []

    def test_malformed_from_line(self):
        """Should handle malformed FROM lines gracefully."""
        dockerfile_content = """
FROM
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine
"""
        from dockerfile_parser import parse_from_lines

        # Should skip malformed line and parse valid one
        result = parse_from_lines(dockerfile_content)

        assert len(result) == 1
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'

    def test_dockerfile_with_windows_line_endings(self):
        """Should handle Windows-style line endings (CRLF)."""
        dockerfile_content = "FROM ghcr.io/groupsky/homy/alpine:3.22.1\r\nWORKDIR /app\r\n"
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert len(result) == 1
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/alpine:3.22.1'

    def test_case_insensitive_from_parsing(self):
        """Should handle lowercase 'from' instruction."""
        dockerfile_content = """
from ghcr.io/groupsky/homy/node:18.20.8-alpine as base
"""
        from dockerfile_parser import parse_from_lines

        result = parse_from_lines(dockerfile_content)

        assert len(result) == 1
        assert result[0]['image'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result[0]['stage'] == 'base'


class TestDockerfileParserIntegration:
    """Integration tests using fixture files."""

    def test_parse_real_automations_dockerfile(self, tmp_path):
        """Should correctly parse the automations service Dockerfile."""
        dockerfile_content = """#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

# Install tools, create app dir, add user and set rights
RUN set -ex && \\
    mkdir -p /usr/src/app && \\
    deluser --remove-home node && \\
    adduser -h /usr/src/app -D -H node-app -u 1000 && \\
    addgroup node-app dialout && \\
    chown -R node-app:node-app /usr/src/app

# Set work directory
WORKDIR /usr/src/app

# copy package.json and lock file
COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

# Install Build tools
RUN apk add --no-cache --virtual buildtools build-base linux-headers udev python3 && \\
    npm ci --unsafe-perm --no-update-notifier --omit=dev && \\
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

USER root

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

# Chown & Clean up
RUN chown -R root:root /usr/src/app && \\
    rm -rf /tmp/*

USER node-app

ENTRYPOINT ["node", "index.js"]
"""
        from dockerfile_parser import (
            parse_from_lines,
            extract_final_stage_base,
            has_healthcheck,
            extract_copy_from_external,
            validate_no_arg_in_from
        )

        # Parse all FROM lines
        from_lines = parse_from_lines(dockerfile_content)
        assert len(from_lines) == 3
        assert from_lines[0]['stage'] == 'base'
        assert from_lines[1]['stage'] == 'build'
        assert from_lines[2]['stage'] == 'RELEASE'

        # Extract final stage base
        final_base = extract_final_stage_base(dockerfile_content)
        assert final_base == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'

        # Check healthcheck
        assert has_healthcheck(dockerfile_content) is False

        # Check COPY --from (should only find internal "build" stage, not external)
        external_copies = extract_copy_from_external(dockerfile_content)
        assert len(external_copies) == 0

        # Validate no ARG in FROM
        validate_no_arg_in_from(dockerfile_content)  # Should not raise

    def test_parse_real_telegram_bridge_dockerfile(self, tmp_path):
        """Should correctly parse the telegram-bridge service Dockerfile with HEALTHCHECK."""
        dockerfile_content = """FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

EXPOSE 3000

CMD ["node", "index.js"]
"""
        from dockerfile_parser import (
            parse_from_lines,
            has_healthcheck,
            parse_healthcheck_params
        )

        # Parse FROM lines
        from_lines = parse_from_lines(dockerfile_content)
        assert len(from_lines) == 1

        # Check healthcheck exists
        assert has_healthcheck(dockerfile_content) is True

        # Parse healthcheck params
        healthcheck = parse_healthcheck_params(dockerfile_content)
        assert healthcheck is not None
        assert healthcheck['interval'] == '30s'
        assert healthcheck['timeout'] == '10s'
        assert healthcheck['start_period'] == '5s'
        assert healthcheck['retries'] == '3'

    def test_parse_base_image_node_dockerfile(self, tmp_path):
        """Should correctly parse base-images/node-18-alpine/Dockerfile."""
        dockerfile_content = """FROM node:18.20.8-alpine3.21
"""
        from dockerfile_parser import parse_base_image_dockerfile

        result = parse_base_image_dockerfile(dockerfile_content)

        assert result is not None
        assert result['upstream_image'] == 'node:18.20.8-alpine3.21'
        assert result['image_name'] == 'node'
        assert result['version_tag'] == '18.20.8-alpine3.21'
