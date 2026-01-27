"""
Test suite for dependency_graph module.

This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
for the dependency_graph module BEFORE implementation. All tests will initially FAIL (red phase)
until the implementation is complete.

The dependency_graph module is responsible for:
1. Building reverse dependency maps (base_image -> [services])
2. Detecting affected services when base images change
3. Handling multi-stage Dockerfiles correctly
4. Supporting services with multiple base image dependencies
5. Gracefully handling edge cases (no dependencies, non-GHCR images)
"""

import pytest
from pathlib import Path
from lib.dependency_graph import (
    build_reverse_dependency_map,
    detect_affected_services,
)


class TestBuildReverseDependencyMap:
    """Test building reverse dependency map from services to base images."""

    def test_single_service_single_dependency(self, temp_repo):
        """Should build map for service with single base image dependency."""
        # Create service Dockerfile
        service_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n"
            "WORKDIR /app\n"
            "COPY . .\n"
        )

        # Service metadata
        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            }
        ]

        # Base image mapping
        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should map base image directory to list of services
        assert 'node-18-alpine' in result
        assert 'automations' in result['node-18-alpine']
        assert len(result['node-18-alpine']) == 1

    def test_multiple_services_same_dependency(self, temp_repo):
        """Should handle multiple services depending on same base image."""
        # Create multiple service Dockerfiles
        automations_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        automations_dockerfile.parent.mkdir(parents=True)
        automations_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n"
        )

        mqtt_influx_dockerfile = temp_repo / "docker" / "mqtt-influx" / "Dockerfile"
        mqtt_influx_dockerfile.parent.mkdir(parents=True)
        mqtt_influx_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n"
        )

        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(automations_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            },
            {
                'service_name': 'mqtt-influx',
                'dockerfile_path': str(mqtt_influx_dockerfile),
                'image': 'ghcr.io/groupsky/homy/mqtt-influx:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Both services should be in the dependency list
        assert 'node-18-alpine' in result
        assert 'automations' in result['node-18-alpine']
        assert 'mqtt-influx' in result['node-18-alpine']
        assert len(result['node-18-alpine']) == 2

    def test_multi_stage_dockerfile_all_from_lines(self, temp_repo):
        """Should extract dependencies from all FROM lines in multi-stage Dockerfile."""
        # Create multi-stage Dockerfile
        service_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text("""
#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

RUN npm ci --omit=dev

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .
""")

        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should still map to automations (only external FROM matters)
        assert 'node-18-alpine' in result
        assert 'automations' in result['node-18-alpine']

    def test_services_with_different_dependencies(self, temp_repo):
        """Should handle services with different base image dependencies."""
        # Create service with node base
        automations_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        automations_dockerfile.parent.mkdir(parents=True)
        automations_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n"
        )

        # Create service with alpine base
        alpine_service_dockerfile = temp_repo / "docker" / "alpine-service" / "Dockerfile"
        alpine_service_dockerfile.parent.mkdir(parents=True)
        alpine_service_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/alpine:3.22.1\n"
        )

        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(automations_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            },
            {
                'service_name': 'alpine-service',
                'dockerfile_path': str(alpine_service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/alpine-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'alpine': 'ghcr.io/groupsky/homy/alpine:3.22.1'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/alpine:3.22.1': 'alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Each base image should map to correct service
        assert 'node-18-alpine' in result
        assert 'automations' in result['node-18-alpine']
        assert 'alpine-service' not in result['node-18-alpine']

        assert 'alpine' in result
        assert 'alpine-service' in result['alpine']
        assert 'automations' not in result['alpine']

    def test_service_with_non_ghcr_base(self, temp_repo):
        """Should skip services with non-GHCR base images."""
        # Create service with non-GHCR base
        service_dockerfile = temp_repo / "docker" / "external-service" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text(
            "FROM scratch\n"
            "COPY binary /app/\n"
        )

        services = [
            {
                'service_name': 'external-service',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/external-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {},
            'ghcr_to_dir': {}
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty map (no GHCR dependencies)
        assert result == {}

    def test_empty_services_list(self, temp_repo):
        """Should handle empty services list gracefully."""
        services = []

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty dict
        assert result == {}


class TestDetectAffectedServices:
    """Test detecting affected services when base images change."""

    def test_single_base_image_change(self, temp_repo):
        """Should identify services affected by single base image change."""
        # Changed base image directory
        changed_base_dirs = ['node-18-alpine']

        # Reverse dependency map
        reverse_deps = {
            'node-18-alpine': ['automations', 'mqtt-influx'],
            'alpine': ['alpine-service']
        }

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'alpine': 'ghcr.io/groupsky/homy/alpine:3.22.1'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/alpine:3.22.1': 'alpine'
            }
        }

        result = detect_affected_services(changed_base_dirs, reverse_deps, base_image_mapping)

        # Should return services depending on node-18-alpine
        assert 'automations' in result
        assert 'mqtt-influx' in result
        assert 'alpine-service' not in result
        assert len(result) == 2

    def test_multiple_base_images_change(self, temp_repo):
        """Should identify all affected services when multiple base images change."""
        # Multiple changed base images
        changed_base_dirs = ['node-18-alpine', 'alpine']

        # Reverse dependency map
        reverse_deps = {
            'node-18-alpine': ['automations', 'mqtt-influx'],
            'alpine': ['alpine-service'],
            'grafana': ['grafana-service']
        }

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'alpine': 'ghcr.io/groupsky/homy/alpine:3.22.1',
                'grafana': 'ghcr.io/groupsky/homy/grafana:9.5.21'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/alpine:3.22.1': 'alpine',
                'ghcr.io/groupsky/homy/grafana:9.5.21': 'grafana'
            }
        }

        result = detect_affected_services(changed_base_dirs, reverse_deps, base_image_mapping)

        # Should return services from both changed base images
        assert 'automations' in result
        assert 'mqtt-influx' in result
        assert 'alpine-service' in result
        assert 'grafana-service' not in result
        assert len(result) == 3

    def test_no_base_image_changes(self, temp_repo):
        """Should return empty list when no base images change."""
        # No changed base images
        changed_base_dirs = []

        # Reverse dependency map
        reverse_deps = {
            'node-18-alpine': ['automations', 'mqtt-influx']
        }

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = detect_affected_services(changed_base_dirs, reverse_deps, base_image_mapping)

        # Should return empty list
        assert result == []

    def test_changed_base_with_no_dependents(self, temp_repo):
        """Should handle base image changes with no dependent services."""
        # Changed base image with no dependents
        changed_base_dirs = ['grafana']

        # Reverse dependency map (grafana not in map)
        reverse_deps = {
            'node-18-alpine': ['automations', 'mqtt-influx']
        }

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'grafana': 'ghcr.io/groupsky/homy/grafana:9.5.21'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/grafana:9.5.21': 'grafana'
            }
        }

        result = detect_affected_services(changed_base_dirs, reverse_deps, base_image_mapping)

        # Should return empty list
        assert result == []


class TestHandleMultipleDependencies:
    """Test handling services with multiple base image dependencies."""

    def test_service_with_copy_from_external(self, temp_repo):
        """Should track dependencies from COPY --from external images."""
        # Create service using COPY --from
        service_dockerfile = temp_repo / "docker" / "multi-dep-service" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text("""
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /app
COPY package*.json ./
RUN npm ci

# Copy from external image
COPY --from=ghcr.io/groupsky/homy/alpine:3.22.1 /etc/ssl/certs /etc/ssl/certs

FROM base AS final
COPY --from=base /app/node_modules ./node_modules
""")

        services = [
            {
                'service_name': 'multi-dep-service',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/multi-dep-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'alpine': 'ghcr.io/groupsky/homy/alpine:3.22.1'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/alpine:3.22.1': 'alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should track both base images as dependencies
        assert 'node-18-alpine' in result
        assert 'multi-dep-service' in result['node-18-alpine']

        # Note: COPY --from external images not currently tracked in basic implementation
        # This is a known limitation - for MVP we only track FROM lines


class TestHandleNoDependencies:
    """Test handling services with no GHCR dependencies."""

    def test_service_from_scratch(self, temp_repo):
        """Should handle FROM scratch without errors."""
        service_dockerfile = temp_repo / "docker" / "scratch-service" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text("""
FROM scratch
COPY binary /app/binary
CMD ["/app/binary"]
""")

        services = [
            {
                'service_name': 'scratch-service',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/scratch-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty map (no GHCR dependencies)
        assert result == {}

    def test_service_from_home_assistant(self, temp_repo):
        """Should handle ghcr.io/home-assistant images (not in our base-images)."""
        service_dockerfile = temp_repo / "docker" / "ha-service" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text("""
FROM ghcr.io/home-assistant/home-assistant:2024.1.0
RUN echo "Custom setup"
""")

        services = [
            {
                'service_name': 'ha-service',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/ha-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty map (home-assistant not in our base-images)
        assert result == {}


class TestRealWorldScenario:
    """Test real-world scenarios with actual service patterns."""

    def test_realistic_multi_service_scenario(self, temp_repo):
        """Should handle realistic scenario with multiple services and base images."""
        # Create automations service
        automations_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        automations_dockerfile.parent.mkdir(parents=True)
        automations_dockerfile.write_text("""
#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

RUN npm ci --omit=dev

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .
""")

        # Create mqtt-influx service
        mqtt_influx_dockerfile = temp_repo / "docker" / "mqtt-influx" / "Dockerfile"
        mqtt_influx_dockerfile.parent.mkdir(parents=True)
        mqtt_influx_dockerfile.write_text("""
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS RELEASE
COPY . .
""")

        # Create telegram-bridge service (different node version)
        telegram_bridge_dockerfile = temp_repo / "docker" / "telegram-bridge" / "Dockerfile"
        telegram_bridge_dockerfile.parent.mkdir(parents=True)
        telegram_bridge_dockerfile.write_text("""
FROM ghcr.io/groupsky/homy/node:22.22.0-alpine3.23

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
""")

        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(automations_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            },
            {
                'service_name': 'mqtt-influx',
                'dockerfile_path': str(mqtt_influx_dockerfile),
                'image': 'ghcr.io/groupsky/homy/mqtt-influx:latest'
            },
            {
                'service_name': 'telegram-bridge',
                'dockerfile_path': str(telegram_bridge_dockerfile),
                'image': 'ghcr.io/groupsky/homy/telegram-bridge:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'node-22-alpine': 'ghcr.io/groupsky/homy/node:22.22.0-alpine3.23'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/node:22.22.0-alpine3.23': 'node-22-alpine'
            }
        }

        # Build reverse dependency map
        result = build_reverse_dependency_map(services, base_image_mapping)

        # Verify node-18-alpine dependencies
        assert 'node-18-alpine' in result
        assert 'automations' in result['node-18-alpine']
        assert 'mqtt-influx' in result['node-18-alpine']
        assert 'telegram-bridge' not in result['node-18-alpine']

        # Verify node-22-alpine dependencies
        assert 'node-22-alpine' in result
        assert 'telegram-bridge' in result['node-22-alpine']
        assert 'automations' not in result['node-22-alpine']

        # Test change detection for node-18-alpine
        changed_base_dirs = ['node-18-alpine']
        affected = detect_affected_services(changed_base_dirs, result, base_image_mapping)

        assert 'automations' in affected
        assert 'mqtt-influx' in affected
        assert 'telegram-bridge' not in affected

        # Test change detection for node-22-alpine
        changed_base_dirs = ['node-22-alpine']
        affected = detect_affected_services(changed_base_dirs, result, base_image_mapping)

        assert 'telegram-bridge' in affected
        assert 'automations' not in affected
        assert 'mqtt-influx' not in affected

    def test_base_image_with_no_version_in_mapping(self, temp_repo):
        """Should handle base image directories not in the mapping gracefully."""
        service_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n"
        )

        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            }
        ]

        # Base image mapping missing the node version
        base_image_mapping = {
            'dir_to_ghcr': {
                'alpine': 'ghcr.io/groupsky/homy/alpine:3.22.1'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/alpine:3.22.1': 'alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty map (base image not in mapping)
        assert result == {}


class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_malformed_dockerfile(self, temp_repo):
        """Should handle malformed Dockerfile gracefully."""
        service_dockerfile = temp_repo / "docker" / "bad-service" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text("""
# No FROM line
RUN echo "This is invalid"
""")

        services = [
            {
                'service_name': 'bad-service',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/bad-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {},
            'ghcr_to_dir': {}
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should handle gracefully and return empty map
        assert result == {}

    def test_missing_dockerfile(self, temp_repo):
        """Should handle missing Dockerfile gracefully."""
        services = [
            {
                'service_name': 'missing-service',
                'dockerfile_path': str(temp_repo / "docker" / "missing" / "Dockerfile"),
                'image': 'ghcr.io/groupsky/homy/missing-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {},
            'ghcr_to_dir': {}
        }

        # Should not raise exception
        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty map
        assert result == {}

    def test_empty_base_image_mapping(self, temp_repo):
        """Should handle empty base image mapping gracefully."""
        service_dockerfile = temp_repo / "docker" / "automations" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text(
            "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n"
        )

        services = [
            {
                'service_name': 'automations',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/automations:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {},
            'ghcr_to_dir': {}
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should return empty map (no base images in mapping)
        assert result == {}

    def test_dockerfile_with_platform_flag(self, temp_repo):
        """Should handle FROM with --platform flag."""
        service_dockerfile = temp_repo / "docker" / "platform-service" / "Dockerfile"
        service_dockerfile.parent.mkdir(parents=True)
        service_dockerfile.write_text("""
FROM --platform=linux/amd64 ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /app
""")

        services = [
            {
                'service_name': 'platform-service',
                'dockerfile_path': str(service_dockerfile),
                'image': 'ghcr.io/groupsky/homy/platform-service:latest'
            }
        ]

        base_image_mapping = {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine'
            }
        }

        result = build_reverse_dependency_map(services, base_image_mapping)

        # Should correctly extract base image despite platform flag
        assert 'node-18-alpine' in result
        assert 'platform-service' in result['node-18-alpine']
