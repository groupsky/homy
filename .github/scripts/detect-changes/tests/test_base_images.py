"""
Test suite for base_images module.

This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
for the base_images module BEFORE implementation. All tests will initially FAIL (red phase)
until the implementation is complete.

The base_images module is responsible for:
1. Discovering all base image directories in base-images/
2. Parsing base image Dockerfiles to extract upstream images and versions
3. Normalizing GHCR tags to match directory naming patterns
4. Building bidirectional mappings between directories and GHCR tags
5. Handling edge cases (missing directories, invalid Dockerfiles)
"""

import pytest
from pathlib import Path
from lib.base_images import (
    discover_base_images,
    parse_base_dockerfile,
    normalize_ghcr_tag,
    build_directory_to_ghcr_mapping,
)


class TestDiscoverBaseImages:
    """Test discovery of all base image directories."""

    def test_discover_all_base_image_directories(self, temp_repo):
        """Should discover all directories in base-images/ with Dockerfiles."""
        # Create test base image directories
        (temp_repo / "base-images" / "node-18-alpine" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "node-18-alpine" / "Dockerfile").write_text(
            "FROM node:18.20.8-alpine3.21\n"
        )

        (temp_repo / "base-images" / "grafana" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "grafana" / "Dockerfile").write_text(
            "FROM grafana/grafana:9.5.21\n"
        )

        (temp_repo / "base-images" / "node-22-alpine" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "node-22-alpine" / "Dockerfile").write_text(
            "FROM node:22.13.1-alpine3.21\n"
        )

        # Create a directory without Dockerfile (should be ignored)
        (temp_repo / "base-images" / "no-dockerfile").mkdir()

        result = discover_base_images(temp_repo / "base-images")

        # Should return list of base image info dicts
        assert len(result) == 3

        # Check that all valid directories were found
        dir_names = [img['directory'] for img in result]
        assert 'node-18-alpine' in dir_names
        assert 'grafana' in dir_names
        assert 'node-22-alpine' in dir_names
        assert 'no-dockerfile' not in dir_names

    def test_discover_returns_empty_list_for_nonexistent_directory(self, temp_repo):
        """Should return empty list if base-images directory doesn't exist."""

        nonexistent = temp_repo / "nonexistent-directory"
        result = discover_base_images(nonexistent)

        assert result == []

    def test_discover_returns_empty_list_for_empty_directory(self, temp_repo):
        """Should return empty list if base-images directory is empty."""

        # base-images exists but is empty
        result = discover_base_images(temp_repo / "base-images")

        assert result == []


class TestParseBaseDockerfile:
    """Test parsing base image Dockerfiles."""

    def test_parse_simple_node_dockerfile(self, temp_repo):
        """Should extract upstream image and version from node Dockerfile."""
        dockerfile_path = temp_repo / "base-images" / "node-18-alpine" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("FROM node:18.20.8-alpine3.21\n")


        result = parse_base_dockerfile(dockerfile_path)

        assert result is not None
        assert result['upstream_image'] == 'node:18.20.8-alpine3.21'
        assert result['image_name'] == 'node'
        assert result['raw_version'] == '18.20.8-alpine3.21'

    def test_parse_grafana_dockerfile(self, temp_repo):
        """Should extract upstream image with registry prefix."""
        dockerfile_path = temp_repo / "base-images" / "grafana" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("FROM grafana/grafana:9.5.21\n")


        result = parse_base_dockerfile(dockerfile_path)

        assert result is not None
        assert result['upstream_image'] == 'grafana/grafana:9.5.21'
        assert result['image_name'] == 'grafana/grafana'
        assert result['raw_version'] == '9.5.21'

    def test_parse_influxdb_dockerfile(self, temp_repo):
        """Should extract version from influxdb Dockerfile."""
        dockerfile_path = temp_repo / "base-images" / "influxdb" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("FROM influxdb:1.8.10\n")


        result = parse_base_dockerfile(dockerfile_path)

        assert result is not None
        assert result['upstream_image'] == 'influxdb:1.8.10'
        assert result['image_name'] == 'influxdb'
        assert result['raw_version'] == '1.8.10'

    def test_parse_dockerfile_without_version_tag(self, temp_repo):
        """Should handle images without explicit version tag."""
        dockerfile_path = temp_repo / "base-images" / "alpine" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("FROM alpine\n")


        result = parse_base_dockerfile(dockerfile_path)

        assert result is not None
        assert result['upstream_image'] == 'alpine'
        assert result['image_name'] == 'alpine'
        assert result['raw_version'] in [None, 'latest', '']

    def test_parse_multi_stage_dockerfile_uses_first_from(self, temp_repo):
        """Should extract from first FROM line in multi-stage Dockerfile."""
        dockerfile_path = temp_repo / "base-images" / "influxdb" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("""FROM influxdb:1.8.10 AS base

RUN apt-get update

FROM base AS final

HEALTHCHECK CMD influx -execute 'SHOW DATABASES'
""")


        result = parse_base_dockerfile(dockerfile_path)

        assert result is not None
        assert result['upstream_image'] == 'influxdb:1.8.10'
        assert result['image_name'] == 'influxdb'
        assert result['raw_version'] == '1.8.10'


class TestNormalizeGhcrTag:
    """Test normalization of GHCR tags from directory names and versions."""

    def test_normalize_node_18_alpine(self):
        """Should normalize node-18-alpine directory to GHCR tag."""

        # Directory: node-18-alpine, Raw version: 18.20.8-alpine3.21
        # Expected: ghcr.io/groupsky/homy/node:18.20.8-alpine
        result = normalize_ghcr_tag('node-18-alpine', '18.20.8-alpine3.21')

        assert result == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'

    def test_normalize_node_22_alpine(self):
        """Should normalize node-22-alpine directory to GHCR tag."""

        # Directory: node-22-alpine, Raw version: 22.13.1-alpine3.21
        # Expected: ghcr.io/groupsky/homy/node:22.13.1-alpine
        result = normalize_ghcr_tag('node-22-alpine', '22.13.1-alpine3.21')

        assert result == 'ghcr.io/groupsky/homy/node:22.13.1-alpine'

    def test_normalize_grafana(self):
        """Should normalize grafana directory to GHCR tag."""

        # Directory: grafana, Raw version: 9.5.21
        # Expected: ghcr.io/groupsky/homy/grafana:9.5.21
        result = normalize_ghcr_tag('grafana', '9.5.21')

        assert result == 'ghcr.io/groupsky/homy/grafana:9.5.21'

    def test_normalize_influxdb(self):
        """Should normalize influxdb directory to GHCR tag."""

        # Directory: influxdb, Raw version: 1.8.10
        # Expected: ghcr.io/groupsky/homy/influxdb:1.8.10
        result = normalize_ghcr_tag('influxdb', '1.8.10')

        assert result == 'ghcr.io/groupsky/homy/influxdb:1.8.10'

    def test_normalize_alpine(self):
        """Should normalize alpine directory to GHCR tag."""

        # Directory: alpine, Raw version: 3.22.1
        # Expected: ghcr.io/groupsky/homy/alpine:3.22.1
        result = normalize_ghcr_tag('alpine', '3.22.1')

        assert result == 'ghcr.io/groupsky/homy/alpine:3.22.1'

    def test_normalize_mosquitto(self):
        """Should normalize mosquitto directory to GHCR tag."""

        # Directory: mosquitto, Raw version: 2.0.20
        # Expected: ghcr.io/groupsky/homy/mosquitto:2.0.20
        result = normalize_ghcr_tag('mosquitto', '2.0.20')

        assert result == 'ghcr.io/groupsky/homy/mosquitto:2.0.20'

    def test_normalize_node_ubuntu(self):
        """Should normalize node-ubuntu directory to GHCR tag."""

        # Directory: node-ubuntu, Raw version: 18.20.5-bullseye
        # Expected: ghcr.io/groupsky/homy/node:18.20.5-bullseye
        result = normalize_ghcr_tag('node-ubuntu', '18.20.5-bullseye')

        assert result == 'ghcr.io/groupsky/homy/node:18.20.5-bullseye'

    def test_normalize_handles_special_node_alpine_pattern(self):
        """Should handle node-*-alpine directory pattern specially."""

        # For node-18-alpine and node-22-alpine directories,
        # we need to strip the alpine3.21 suffix to get alpine tag
        result1 = normalize_ghcr_tag('node-18-alpine', '18.20.8-alpine3.21')
        result2 = normalize_ghcr_tag('node-22-alpine', '22.13.1-alpine3.21')

        # Both should strip alpine3.21 to just alpine
        assert result1 == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result2 == 'ghcr.io/groupsky/homy/node:22.13.1-alpine'


class TestBuildDirectoryToGhcrMapping:
    """Test building bidirectional mappings between directories and GHCR tags."""

    def test_build_mapping_from_discovered_images(self, temp_repo):
        """Should create bidirectional mapping from directory to GHCR tag and back."""
        # Create test base images
        (temp_repo / "base-images" / "node-18-alpine" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "node-18-alpine" / "Dockerfile").write_text(
            "FROM node:18.20.8-alpine3.21\n"
        )

        (temp_repo / "base-images" / "grafana" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "grafana" / "Dockerfile").write_text(
            "FROM grafana/grafana:9.5.21\n"
        )


        result = build_directory_to_ghcr_mapping(temp_repo / "base-images")

        # Should return dict with both directions
        assert 'dir_to_ghcr' in result
        assert 'ghcr_to_dir' in result

        # Check directory -> GHCR mapping
        assert result['dir_to_ghcr']['node-18-alpine'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result['dir_to_ghcr']['grafana'] == 'ghcr.io/groupsky/homy/grafana:9.5.21'

        # Check GHCR -> directory mapping
        assert result['ghcr_to_dir']['ghcr.io/groupsky/homy/node:18.20.8-alpine'] == 'node-18-alpine'
        assert result['ghcr_to_dir']['ghcr.io/groupsky/homy/grafana:9.5.21'] == 'grafana'

    def test_mapping_handles_multiple_node_variants(self, temp_repo):
        """Should correctly map multiple node-*-alpine directories."""
        # Create multiple node variants
        (temp_repo / "base-images" / "node-18-alpine" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "node-18-alpine" / "Dockerfile").write_text(
            "FROM node:18.20.8-alpine3.21\n"
        )

        (temp_repo / "base-images" / "node-22-alpine" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "node-22-alpine" / "Dockerfile").write_text(
            "FROM node:22.13.1-alpine3.21\n"
        )

        (temp_repo / "base-images" / "node-ubuntu" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "node-ubuntu" / "Dockerfile").write_text(
            "FROM node:18.20.5-bullseye\n"
        )


        result = build_directory_to_ghcr_mapping(temp_repo / "base-images")

        # All three should have different GHCR tags
        assert result['dir_to_ghcr']['node-18-alpine'] == 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        assert result['dir_to_ghcr']['node-22-alpine'] == 'ghcr.io/groupsky/homy/node:22.13.1-alpine'
        assert result['dir_to_ghcr']['node-ubuntu'] == 'ghcr.io/groupsky/homy/node:18.20.5-bullseye'

        # Reverse mapping should work
        assert result['ghcr_to_dir']['ghcr.io/groupsky/homy/node:18.20.8-alpine'] == 'node-18-alpine'
        assert result['ghcr_to_dir']['ghcr.io/groupsky/homy/node:22.13.1-alpine'] == 'node-22-alpine'
        assert result['ghcr_to_dir']['ghcr.io/groupsky/homy/node:18.20.5-bullseye'] == 'node-ubuntu'

    def test_mapping_empty_for_nonexistent_directory(self, temp_repo):
        """Should return empty mappings if base-images doesn't exist."""

        result = build_directory_to_ghcr_mapping(temp_repo / "nonexistent")

        assert result['dir_to_ghcr'] == {}
        assert result['ghcr_to_dir'] == {}


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_discover_handles_missing_base_images_directory(self, temp_repo):
        """Should gracefully handle missing base-images directory."""

        # Remove base-images if it exists
        import shutil
        if (temp_repo / "base-images").exists():
            shutil.rmtree(temp_repo / "base-images")

        result = discover_base_images(temp_repo / "base-images")

        # Should return empty list, not raise exception
        assert result == []

    def test_parse_handles_malformed_dockerfile(self, temp_repo):
        """Should handle Dockerfile without FROM line gracefully."""
        dockerfile_path = temp_repo / "base-images" / "bad" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("# No FROM line\nRUN echo hello\n")


        result = parse_base_dockerfile(dockerfile_path)

        # Should return None or raise informative error
        assert result is None or result.get('upstream_image') is None

    def test_parse_handles_empty_dockerfile(self, temp_repo):
        """Should handle empty Dockerfile gracefully."""
        dockerfile_path = temp_repo / "base-images" / "empty" / "Dockerfile"
        dockerfile_path.parent.mkdir(parents=True)
        dockerfile_path.write_text("")


        result = parse_base_dockerfile(dockerfile_path)

        # Should return None or handle gracefully
        assert result is None or result.get('upstream_image') is None

    def test_normalize_handles_missing_version(self):
        """Should handle normalization when version is None."""

        # Should handle gracefully, perhaps defaulting to :latest
        result = normalize_ghcr_tag('alpine', None)

        # Should return valid tag or raise informative error
        assert result is not None
        assert result.startswith('ghcr.io/groupsky/homy/')

    def test_discover_skips_hidden_directories(self, temp_repo):
        """Should skip hidden directories (starting with .)."""
        # Create hidden directory
        (temp_repo / "base-images" / ".hidden" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / ".hidden" / "Dockerfile").write_text("FROM alpine\n")

        # Create normal directory
        (temp_repo / "base-images" / "alpine" / "Dockerfile").parent.mkdir(parents=True)
        (temp_repo / "base-images" / "alpine" / "Dockerfile").write_text("FROM alpine:3.22.1\n")


        result = discover_base_images(temp_repo / "base-images")

        # Should only find alpine, not .hidden
        dir_names = [img['directory'] for img in result]
        assert 'alpine' in dir_names
        assert '.hidden' not in dir_names


class TestIntegration:
    """Integration tests using realistic base-images structure."""

    def test_complete_workflow_with_multiple_images(self, temp_repo):
        """Should handle complete workflow from discovery to mapping."""
        # Create realistic base-images structure
        base_images_dir = temp_repo / "base-images"

        images = {
            'node-18-alpine': 'FROM node:18.20.8-alpine3.21\n',
            'node-22-alpine': 'FROM node:22.13.1-alpine3.21\n',
            'grafana': 'FROM grafana/grafana:9.5.21\n',
            'influxdb': 'FROM influxdb:1.8.10\n',
            'mosquitto': 'FROM eclipse-mosquitto:2.0.20\n',
            'alpine': 'FROM alpine:3.22.1\n',
        }

        for dir_name, dockerfile_content in images.items():
            dockerfile_path = base_images_dir / dir_name / "Dockerfile"
            dockerfile_path.parent.mkdir(parents=True)
            dockerfile_path.write_text(dockerfile_content)

        # Discover all images
        discovered = discover_base_images(base_images_dir)
        assert len(discovered) == 6

        # Build mapping
        mapping = build_directory_to_ghcr_mapping(base_images_dir)

        # Verify all expected mappings exist
        expected_mappings = {
            'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
            'node-22-alpine': 'ghcr.io/groupsky/homy/node:22.13.1-alpine',
            'grafana': 'ghcr.io/groupsky/homy/grafana:9.5.21',
            'influxdb': 'ghcr.io/groupsky/homy/influxdb:1.8.10',
            'alpine': 'ghcr.io/groupsky/homy/alpine:3.22.1',
        }

        for dir_name, expected_tag in expected_mappings.items():
            assert mapping['dir_to_ghcr'][dir_name] == expected_tag
            assert mapping['ghcr_to_dir'][expected_tag] == dir_name

    def test_handles_real_world_dockerfile_variations(self, temp_repo):
        """Should handle real-world Dockerfile variations."""
        base_images_dir = temp_repo / "base-images"

        # Dockerfile with comments
        (base_images_dir / "commented" / "Dockerfile").parent.mkdir(parents=True)
        (base_images_dir / "commented" / "Dockerfile").write_text("""# This is a comment
# Another comment
FROM alpine:3.22.1

# Post-FROM comment
RUN apk add --no-cache curl
""")

        # Dockerfile with lowercase FROM
        (base_images_dir / "lowercase" / "Dockerfile").parent.mkdir(parents=True)
        (base_images_dir / "lowercase" / "Dockerfile").write_text("from node:18.20.8-alpine3.21\n")

        # Multi-stage Dockerfile
        (base_images_dir / "multistage" / "Dockerfile").parent.mkdir(parents=True)
        (base_images_dir / "multistage" / "Dockerfile").write_text("""FROM influxdb:1.8.10 AS base

RUN apt-get update

FROM base AS final
""")


        result = discover_base_images(base_images_dir)

        # Should successfully parse all variations
        assert len(result) == 3

        dir_names = [img['directory'] for img in result]
        assert 'commented' in dir_names
        assert 'lowercase' in dir_names
        assert 'multistage' in dir_names
