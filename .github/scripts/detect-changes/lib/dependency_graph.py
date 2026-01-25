"""
Dependency graph construction for Docker images.

Builds reverse dependency mappings to track which services depend on which base images.
This enables efficient detection of affected services when base images change.

Key functions:
- build_reverse_dependency_map: Create base_image -> [services] mapping
- detect_affected_services: Find services affected by base image changes
"""

from pathlib import Path
from typing import Dict, List

from dockerfile_parser import parse_from_lines


def build_reverse_dependency_map(
    services: List[Dict],
    base_image_mapping: Dict[str, Dict[str, str]]
) -> Dict[str, List[str]]:
    """
    Build reverse dependency map from base images to dependent services.

    Scans all service Dockerfiles to extract their base image dependencies,
    then creates a mapping of base_image_directory -> [service_names].

    Args:
        services: List of service metadata dicts with keys:
            - service_name: Name of the service
            - dockerfile_path: Path to service Dockerfile
            - image: Service image name
        base_image_mapping: Bidirectional mapping dict with keys:
            - dir_to_ghcr: directory -> GHCR tag mapping
            - ghcr_to_dir: GHCR tag -> directory mapping

    Returns:
        Dictionary mapping base image directories to lists of dependent services.
        Example: {'node-18-alpine': ['automations', 'mqtt-influx']}

    Note:
        - Only tracks GHCR base images (ghcr.io/groupsky/homy/*)
        - Handles multi-stage Dockerfiles by extracting all FROM lines
        - Gracefully handles missing or malformed Dockerfiles
    """
    reverse_deps = {}

    # Get the GHCR to directory mapping
    ghcr_to_dir = base_image_mapping.get('ghcr_to_dir', {})

    # Process each service
    for service in services:
        service_name = service['service_name']
        dockerfile_path = service['dockerfile_path']

        # Read the Dockerfile
        try:
            with open(dockerfile_path, 'r') as f:
                dockerfile_content = f.read()
        except (FileNotFoundError, IOError):
            # Skip services with missing/unreadable Dockerfiles
            continue

        # Parse FROM lines
        from_lines = parse_from_lines(dockerfile_content)

        if not from_lines:
            # No FROM lines found
            continue

        # Extract unique base images
        base_images = set()
        for from_line in from_lines:
            image = from_line.get('image')
            if image:
                base_images.add(image)

        # Map base images to directories
        for base_image in base_images:
            # Check if this is a GHCR image in our mapping
            if base_image in ghcr_to_dir:
                base_dir = ghcr_to_dir[base_image]

                # Add service to the reverse dependency list
                if base_dir not in reverse_deps:
                    reverse_deps[base_dir] = []

                if service_name not in reverse_deps[base_dir]:
                    reverse_deps[base_dir].append(service_name)

    return reverse_deps


def detect_affected_services(
    changed_base_dirs: List[str],
    reverse_deps: Dict[str, List[str]],
    base_image_mapping: Dict[str, Dict[str, str]]
) -> List[str]:
    """
    Detect services affected by base image directory changes.

    Args:
        changed_base_dirs: List of base image directory names that changed
        reverse_deps: Reverse dependency map (base_dir -> [services])
        base_image_mapping: Bidirectional base image mapping (currently unused,
            but kept for API consistency and future enhancements)

    Returns:
        List of unique service names affected by the base image changes.
        Returns empty list if no services are affected.

    Example:
        >>> changed_base_dirs = ['node-18-alpine']
        >>> reverse_deps = {'node-18-alpine': ['automations', 'mqtt-influx']}
        >>> detect_affected_services(changed_base_dirs, reverse_deps, {})
        ['automations', 'mqtt-influx']
    """
    affected_services = set()

    # For each changed base image directory
    for base_dir in changed_base_dirs:
        # Get services that depend on this base image
        dependent_services = reverse_deps.get(base_dir, [])

        # Add to affected services set
        affected_services.update(dependent_services)

    # Return as sorted list for consistent output
    return sorted(list(affected_services))
