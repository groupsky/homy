"""
Service discovery from docker-compose.yml.

Parses docker-compose.yml to find services with build configurations
and extracts their Dockerfile paths and contexts.
"""

import json
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any


def discover_services_from_compose(compose_file: str) -> List[Dict[str, Any]]:
    """
    Discover services from docker-compose.yml using docker compose config.

    Executes 'docker compose --env-file example.env config --format json' to get
    the fully-resolved compose configuration, then filters for services with:
    - GHCR images (ghcr.io/groupsky/homy/*)
    - Build context defined

    Args:
        compose_file: Path to docker-compose.yml file

    Returns:
        List of service metadata dicts containing:
        - service_name: Name of the service
        - image: Full GHCR image path
        - build_context: Path to build directory
        - dockerfile_path: Resolved Dockerfile path
        - build_args: Build arguments (if present)

    Raises:
        RuntimeError: If docker compose command fails
        json.JSONDecodeError: If docker compose returns invalid JSON
    """
    # Get the directory containing the compose file
    compose_dir = Path(compose_file).parent

    # Execute docker compose config to get resolved configuration
    result = subprocess.run(
        [
            'docker', 'compose',
            '--env-file', 'example.env',
            '-f', compose_file,
            'config',
            '--format', 'json'
        ],
        cwd=compose_dir,
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        raise RuntimeError(f"docker compose config failed: {result.stderr}")

    # Parse JSON output
    config = json.loads(result.stdout)

    # Extract services section
    services_config = config.get('services', {})

    # Extract metadata for each service
    services = []
    for service_name, service_config in services_config.items():
        metadata = extract_service_metadata(service_name, service_config)
        if metadata is not None:
            services.append(metadata)

    # Filter to only GHCR-based services
    return filter_ghcr_services(services)


def extract_service_metadata(service_name: str, service_config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Extract metadata from a service configuration.

    Args:
        service_name: Name of the service in docker-compose.yml
        service_config: Service configuration dict from docker compose config

    Returns:
        Service metadata dict or None if service has no valid build context

    The returned dict contains:
        - service_name: Name of the service
        - image: Full image path (may be None if not specified)
        - build_context: Path to build directory
        - dockerfile_path: Resolved Dockerfile path
        - build_args: Build arguments (if present)
    """
    # Get image (may not exist for some configs)
    image = service_config.get('image')

    # Get build configuration
    build = service_config.get('build')

    # If no build directive, return None
    if not build:
        return None

    # Handle string build context (shorthand notation)
    if isinstance(build, str):
        build_context = build.strip()
        dockerfile = 'Dockerfile'
        build_args = None
    # Handle dict build context (full notation)
    elif isinstance(build, dict):
        build_context = build.get('context')

        # If no context in dict, return None
        if not build_context:
            return None

        build_context = build_context.strip()
        dockerfile = build.get('dockerfile', 'Dockerfile').strip()
        build_args = build.get('args')
    else:
        # Invalid build type
        return None

    # Resolve dockerfile path
    dockerfile_path = str(Path(build_context) / dockerfile)

    # Build metadata dict
    metadata = {
        'service_name': service_name,
        'image': image,
        'build_context': build_context,
        'dockerfile_path': dockerfile_path,
    }

    # Add build args if present
    if build_args:
        metadata['build_args'] = build_args

    return metadata


def filter_ghcr_services(services: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Filter services to only include GHCR-based images.

    Filters for services with images starting with 'ghcr.io/groupsky/homy/'.

    Args:
        services: List of service metadata dicts

    Returns:
        Filtered list containing only GHCR-based services
    """
    ghcr_prefix = 'ghcr.io/groupsky/homy/'

    return [
        service for service in services
        if service.get('image') and service['image'].startswith(ghcr_prefix)
    ]
