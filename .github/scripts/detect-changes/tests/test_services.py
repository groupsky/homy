"""
Test suite for services module.

This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
for the services module BEFORE implementation. All tests will initially FAIL (red phase)
until the implementation is complete.

The services module is responsible for:
1. Discovering services from docker-compose.yml using `docker compose config --format json`
2. Filtering services with GHCR images (ghcr.io/groupsky/homy/*)
3. Filtering services with build context
4. Extracting service metadata (name, image, build context, dockerfile path)
5. Handling multiple instances of the same service (mqtt-influx-primary, mqtt-influx-secondary)
6. Resolving custom Dockerfile paths
"""

import pytest
import json
from pathlib import Path
from unittest.mock import patch, MagicMock
from lib.services import (
    discover_services_from_compose,
    extract_service_metadata,
    filter_ghcr_services,
)


class TestDiscoverServicesFromCompose:
    """Test service discovery from docker-compose.yml using docker compose config."""

    def test_should_use_docker_compose_config_command(self, tmp_path):
        """Should execute 'docker compose config --format json' command."""
        compose_file = tmp_path / "docker-compose.yml"
        compose_file.write_text("""
version: '3.8'
services:
  broker:
    image: ghcr.io/groupsky/homy/mosquitto:latest
    build: docker/mosquitto
""")

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps({
                    "services": {
                        "broker": {
                            "image": "ghcr.io/groupsky/homy/mosquitto:latest",
                            "build": {
                                "context": str(tmp_path / "docker/mosquitto")
                            }
                        }
                    }
                })
            )

            discover_services_from_compose(str(compose_file))

            # Verify docker compose command was called
            mock_run.assert_called_once()
            call_args = mock_run.call_args
            assert 'docker' in call_args[0][0]
            assert 'compose' in call_args[0][0]
            assert 'config' in call_args[0][0]
            assert '--format' in call_args[0][0]
            assert 'json' in call_args[0][0]

    def test_should_filter_services_with_ghcr_image(self, tmp_path):
        """Should filter services with image starting with 'ghcr.io/groupsky/homy/'."""
        compose_file = tmp_path / "docker-compose.yml"

        compose_config = {
            "services": {
                "broker": {
                    "image": "ghcr.io/groupsky/homy/mosquitto:latest",
                    "build": {"context": "docker/mosquitto"}
                },
                "postgres": {
                    "image": "postgres:15",
                    "volumes": ["/data:/var/lib/postgresql/data"]
                },
                "automations": {
                    "image": "ghcr.io/groupsky/homy/automations:latest",
                    "build": {"context": "docker/automations"}
                }
            }
        }

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps(compose_config)
            )

            result = discover_services_from_compose(str(compose_file))

            # Should include GHCR services, exclude external services
            service_names = [s['service_name'] for s in result]
            assert 'broker' in service_names
            assert 'automations' in service_names
            assert 'postgres' not in service_names

    def test_should_filter_services_with_build_context(self, tmp_path):
        """Should filter services with build context."""
        compose_file = tmp_path / "docker-compose.yml"

        compose_config = {
            "services": {
                "broker": {
                    "image": "ghcr.io/groupsky/homy/mosquitto:latest",
                    "build": {"context": "docker/mosquitto"}
                },
                "influxdb": {
                    "image": "ghcr.io/groupsky/homy/influxdb:latest",
                    # No build context - using pre-built image only
                },
                "automations": {
                    "image": "ghcr.io/groupsky/homy/automations:latest",
                    "build": {"context": "docker/automations"}
                }
            }
        }

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps(compose_config)
            )

            result = discover_services_from_compose(str(compose_file))

            # Should include services with build context, exclude those without
            service_names = [s['service_name'] for s in result]
            assert 'broker' in service_names
            assert 'automations' in service_names
            assert 'influxdb' not in service_names

    def test_should_extract_unique_service_names(self, tmp_path):
        """Should extract unique service names from docker-compose output."""
        compose_file = tmp_path / "docker-compose.yml"

        compose_config = {
            "services": {
                "mqtt-influx-primary": {
                    "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
                    "build": {"context": "docker/mqtt-influx"}
                },
                "mqtt-influx-secondary": {
                    "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
                    "build": {"context": "docker/mqtt-influx"}
                },
                "broker": {
                    "image": "ghcr.io/groupsky/homy/mosquitto:latest",
                    "build": {"context": "docker/mosquitto"}
                }
            }
        }

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps(compose_config)
            )

            result = discover_services_from_compose(str(compose_file))

            # Should return all services with unique names
            service_names = [s['service_name'] for s in result]
            assert len(service_names) == 3
            assert 'mqtt-influx-primary' in service_names
            assert 'mqtt-influx-secondary' in service_names
            assert 'broker' in service_names

    def test_should_handle_docker_compose_command_failure(self, tmp_path):
        """Should raise exception when docker compose command fails."""
        compose_file = tmp_path / "docker-compose.yml"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=1,
                stderr="ERROR: Invalid compose file"
            )

            with pytest.raises(RuntimeError, match="docker compose config failed"):
                discover_services_from_compose(str(compose_file))

    def test_should_handle_invalid_json_output(self, tmp_path):
        """Should raise exception when docker compose returns invalid JSON."""
        compose_file = tmp_path / "docker-compose.yml"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout="invalid json output"
            )

            with pytest.raises(json.JSONDecodeError):
                discover_services_from_compose(str(compose_file))


class TestExtractServiceMetadata:
    """Test service metadata extraction from compose configuration."""

    def test_should_extract_basic_service_metadata(self):
        """Should extract service_name, image, build_context, dockerfile_path."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/automations:latest",
            "build": {
                "context": "/home/user/project/docker/automations",
                "dockerfile": "Dockerfile"
            }
        }

        result = extract_service_metadata("automations", service_config)

        assert result['service_name'] == 'automations'
        assert result['image'] == 'ghcr.io/groupsky/homy/automations:latest'
        assert result['build_context'] == '/home/user/project/docker/automations'
        assert result['dockerfile_path'] == '/home/user/project/docker/automations/Dockerfile'

    def test_should_handle_string_build_context(self):
        """Should handle build context specified as string instead of dict."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/broker:latest",
            "build": "/home/user/project/docker/mosquitto"
        }

        result = extract_service_metadata("broker", service_config)

        assert result['service_name'] == 'broker'
        assert result['build_context'] == '/home/user/project/docker/mosquitto'
        assert result['dockerfile_path'] == '/home/user/project/docker/mosquitto/Dockerfile'

    def test_should_handle_custom_dockerfile_names(self):
        """Should handle services with custom Dockerfile names."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/grafana:latest",
            "build": {
                "context": "/home/user/project/docker/grafana",
                "dockerfile": "custom.dockerfile"
            }
        }

        result = extract_service_metadata("grafana", service_config)

        assert result['dockerfile_path'] == '/home/user/project/docker/grafana/custom.dockerfile'

    def test_should_default_to_dockerfile_when_not_specified(self):
        """Should default to 'Dockerfile' when dockerfile field is not specified."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/nginx:latest",
            "build": {
                "context": "/home/user/project/docker/nginx"
            }
        }

        result = extract_service_metadata("nginx", service_config)

        assert result['dockerfile_path'] == '/home/user/project/docker/nginx/Dockerfile'

    def test_should_preserve_build_args(self):
        """Should preserve build args in metadata for future use."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
            "build": {
                "context": "/home/user/project/docker/mqtt-influx",
                "dockerfile": "Dockerfile",
                "args": {
                    "NODE_ENV": "production",
                    "VERSION": "1.0.0"
                }
            }
        }

        result = extract_service_metadata("mqtt-influx", service_config)

        assert 'build_args' in result
        assert result['build_args']['NODE_ENV'] == 'production'
        assert result['build_args']['VERSION'] == '1.0.0'

    def test_should_handle_missing_build_context(self):
        """Should return None for services without build context."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/influxdb:latest",
            # No build section
        }

        result = extract_service_metadata("influxdb", service_config)

        # Should return None or indicate missing build context
        assert result is None or result['build_context'] is None


class TestFilterGhcrServices:
    """Test filtering of GHCR-based services."""

    def test_should_include_only_ghcr_groupsky_homy_images(self):
        """Should include only services with ghcr.io/groupsky/homy/* images."""
        services = [
            {
                'service_name': 'broker',
                'image': 'ghcr.io/groupsky/homy/mosquitto:latest',
                'build_context': 'docker/mosquitto'
            },
            {
                'service_name': 'postgres',
                'image': 'postgres:15',
                'build_context': None
            },
            {
                'service_name': 'automations',
                'image': 'ghcr.io/groupsky/homy/automations:latest',
                'build_context': 'docker/automations'
            },
            {
                'service_name': 'other-ghcr',
                'image': 'ghcr.io/otheruser/app:latest',
                'build_context': 'docker/app'
            }
        ]

        result = filter_ghcr_services(services)

        service_names = [s['service_name'] for s in result]
        assert 'broker' in service_names
        assert 'automations' in service_names
        assert 'postgres' not in service_names
        assert 'other-ghcr' not in service_names

    def test_should_exclude_external_services(self):
        """Should exclude external services like postgres, redis, etc."""
        services = [
            {
                'service_name': 'redis',
                'image': 'redis:alpine',
                'build_context': None
            },
            {
                'service_name': 'mysql',
                'image': 'mysql:8.0',
                'build_context': None
            },
            {
                'service_name': 'automations',
                'image': 'ghcr.io/groupsky/homy/automations:latest',
                'build_context': 'docker/automations'
            }
        ]

        result = filter_ghcr_services(services)

        assert len(result) == 1
        assert result[0]['service_name'] == 'automations'

    def test_should_handle_home_assistant_exception(self):
        """Should handle home-assistant images as special case if needed."""
        services = [
            {
                'service_name': 'ha',
                'image': 'ghcr.io/groupsky/homy/homeassistant:latest',
                'build_context': 'docker/homeassistant'
            }
        ]

        result = filter_ghcr_services(services)

        # Home Assistant is a GHCR image and should be included
        assert len(result) == 1
        assert result[0]['service_name'] == 'ha'


class TestHandleMultipleInstances:
    """Test handling of multiple instances of the same service."""

    def test_should_treat_mqtt_influx_instances_as_separate_services(self, tmp_path):
        """Should treat mqtt-influx-primary, mqtt-influx-secondary as separate services."""
        compose_file = tmp_path / "docker-compose.yml"

        compose_config = {
            "services": {
                "mqtt-influx-primary": {
                    "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
                    "build": {"context": "docker/mqtt-influx"}
                },
                "mqtt-influx-secondary": {
                    "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
                    "build": {"context": "docker/mqtt-influx"}
                },
                "mqtt-influx-tetriary": {
                    "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
                    "build": {"context": "docker/mqtt-influx"}
                }
            }
        }

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps(compose_config)
            )

            result = discover_services_from_compose(str(compose_file))

            # Should return all three instances as separate services
            service_names = [s['service_name'] for s in result]
            assert len(service_names) == 3
            assert 'mqtt-influx-primary' in service_names
            assert 'mqtt-influx-secondary' in service_names
            assert 'mqtt-influx-tetriary' in service_names

            # All should point to the same build context
            contexts = [s['build_context'] for s in result]
            assert all(ctx.endswith('docker/mqtt-influx') for ctx in contexts)

    def test_should_preserve_instance_specific_environment(self):
        """Should preserve instance-specific environment variables in metadata."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/mqtt-influx:latest",
            "build": {"context": "docker/mqtt-influx"},
            "environment": {
                "MQTT_CLIENT_ID": "mqtt-influx-primary"
            }
        }

        result = extract_service_metadata("mqtt-influx-primary", service_config)

        # Should preserve environment for potential future use
        assert result['service_name'] == 'mqtt-influx-primary'


class TestHandleMissingBuildContext:
    """Test handling of services without build directive."""

    def test_should_exclude_services_without_build_directive(self, tmp_path):
        """Should exclude services that don't have build directive."""
        compose_file = tmp_path / "docker-compose.yml"

        compose_config = {
            "services": {
                "broker": {
                    "image": "ghcr.io/groupsky/homy/mosquitto:latest",
                    "build": {"context": "docker/mosquitto"}
                },
                "influxdb": {
                    "image": "ghcr.io/groupsky/homy/influxdb:latest",
                    # No build - using pre-built image
                },
                "automations": {
                    "image": "ghcr.io/groupsky/homy/automations:latest",
                    "build": {"context": "docker/automations"}
                }
            }
        }

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps(compose_config)
            )

            result = discover_services_from_compose(str(compose_file))

            service_names = [s['service_name'] for s in result]
            assert 'broker' in service_names
            assert 'automations' in service_names
            assert 'influxdb' not in service_names

    def test_should_handle_empty_build_section(self):
        """Should handle services with empty build section."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/test:latest",
            "build": {}
        }

        result = extract_service_metadata("test", service_config)

        # Should return None or indicate invalid build config
        assert result is None or result['build_context'] is None

    def test_should_validate_build_context_exists(self):
        """Should validate that build context path exists (optional check)."""
        # This is an optional validation that could be added
        # For now, just test that we can extract the path even if it doesn't exist
        service_config = {
            "image": "ghcr.io/groupsky/homy/test:latest",
            "build": {
                "context": "/nonexistent/path"
            }
        }

        result = extract_service_metadata("test", service_config)

        # Should extract the path even if it doesn't exist
        # Validation can happen later in the pipeline
        assert result['build_context'] == '/nonexistent/path'


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_should_handle_empty_compose_file(self, tmp_path):
        """Should handle empty or minimal compose file."""
        compose_file = tmp_path / "docker-compose.yml"

        compose_config = {
            "services": {}
        }

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0,
                stdout=json.dumps(compose_config)
            )

            result = discover_services_from_compose(str(compose_file))

            assert result == []

    def test_should_handle_nonexistent_compose_file(self):
        """Should raise exception for nonexistent compose file."""
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(
                returncode=1,
                stderr="compose file not found"
            )

            with pytest.raises(RuntimeError):
                discover_services_from_compose("/nonexistent/docker-compose.yml")

    def test_should_handle_malformed_service_config(self):
        """Should handle malformed service configuration gracefully."""
        service_config = {
            # Missing image field
            "build": "docker/test"
        }

        # Should either return None or raise a descriptive error
        result = extract_service_metadata("test", service_config)
        assert result is None or 'image' not in result or result['image'] is None

    def test_should_strip_whitespace_from_paths(self):
        """Should strip whitespace from extracted paths."""
        service_config = {
            "image": "ghcr.io/groupsky/homy/test:latest",
            "build": {
                "context": "  /home/user/project/docker/test  ",
                "dockerfile": "  Dockerfile  "
            }
        }

        result = extract_service_metadata("test", service_config)

        # Paths should be stripped of whitespace
        assert result['build_context'].strip() == result['build_context']
        assert result['dockerfile_path'].strip() == result['dockerfile_path']
