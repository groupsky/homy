"""
Base image discovery and parsing.

Handles discovering base image directories, parsing their Dockerfiles,
and building mappings between directory names and GHCR tags.
"""

from pathlib import Path
from typing import Dict, List, Optional

from dockerfile_parser import parse_base_image_dockerfile
from version_normalizer import normalize_version


def discover_base_images(base_images_path: Path) -> List[Dict[str, str]]:
    """
    Discover all base image directories with Dockerfiles.

    Args:
        base_images_path: Path to base-images/ directory

    Returns:
        List of dictionaries containing base image information:
        - 'directory': Directory name
        - 'dockerfile_path': Path to the Dockerfile
        - 'upstream_image': Upstream image reference
        - 'image_name': Image name without registry/tag
        - 'raw_version': Raw version tag from upstream image

    Example:
        >>> discover_base_images(Path('base-images'))
        [
            {
                'directory': 'node-18-alpine',
                'dockerfile_path': 'base-images/node-18-alpine/Dockerfile',
                'upstream_image': 'node:18.20.8-alpine3.21',
                'image_name': 'node',
                'raw_version': '18.20.8-alpine3.21'
            }
        ]
    """
    if not base_images_path.exists():
        return []

    if not base_images_path.is_dir():
        return []

    result = []

    # Iterate through all subdirectories
    for item in base_images_path.iterdir():
        # Skip non-directories
        if not item.is_dir():
            continue

        # Skip hidden directories (starting with .)
        if item.name.startswith('.'):
            continue

        # Check if Dockerfile exists
        dockerfile_path = item / 'Dockerfile'
        if not dockerfile_path.exists():
            continue

        # Parse the Dockerfile
        parsed = parse_base_dockerfile(dockerfile_path)
        if parsed:
            result.append({
                'directory': item.name,
                'dockerfile_path': str(dockerfile_path),
                **parsed
            })

    return result


def parse_base_dockerfile(dockerfile_path: Path) -> Optional[Dict[str, Optional[str]]]:
    """
    Parse a base image Dockerfile to extract upstream image information.

    Args:
        dockerfile_path: Path to the Dockerfile

    Returns:
        Dictionary with keys:
        - 'upstream_image': Full upstream image reference
        - 'image_name': Image name without registry/tag
        - 'raw_version': Version tag from upstream image

        Returns None if parsing fails or no FROM line found.

    Example:
        >>> parse_base_dockerfile(Path('base-images/node-18-alpine/Dockerfile'))
        {
            'upstream_image': 'node:18.20.8-alpine3.21',
            'image_name': 'node',
            'raw_version': '18.20.8-alpine3.21'
        }
    """
    try:
        content = dockerfile_path.read_text()
    except Exception:
        return None

    # Use the existing dockerfile_parser module
    parsed = parse_base_image_dockerfile(content)

    if not parsed:
        return None

    # Map the keys to match expected test output
    return {
        'upstream_image': parsed.get('upstream_image'),
        'image_name': parsed.get('image_name'),
        'raw_version': parsed.get('version_tag')
    }


def normalize_ghcr_tag(directory_name: str, raw_version: Optional[str]) -> str:
    """
    Convert directory name and version to normalized GHCR tag.

    Special handling for node-*-alpine directories:
    - Strips alpine3.21 suffix to just alpine
    - Maps node-18-alpine to ghcr.io/groupsky/homy/node:X.Y.Z-alpine

    Args:
        directory_name: Base image directory name (e.g., 'node-18-alpine', 'grafana')
        raw_version: Raw version tag from upstream image (e.g., '18.20.8-alpine3.21')

    Returns:
        Normalized GHCR tag (e.g., 'ghcr.io/groupsky/homy/node:18.20.8-alpine')

    Example:
        >>> normalize_ghcr_tag('node-18-alpine', '18.20.8-alpine3.21')
        'ghcr.io/groupsky/homy/node:18.20.8-alpine'

        >>> normalize_ghcr_tag('grafana', '9.5.21')
        'ghcr.io/groupsky/homy/grafana:9.5.21'
    """
    # Handle None version
    if raw_version is None:
        raw_version = 'latest'

    # Normalize the version using version_normalizer
    normalized_version = normalize_version(raw_version)

    # Determine the image name from directory name
    # For node-*-alpine and node-* directories, use 'node'
    # For other directories, use the directory name as-is
    if directory_name.startswith('node-'):
        image_name = 'node'
    else:
        image_name = directory_name

    # Build the GHCR tag
    return f'ghcr.io/groupsky/homy/{image_name}:{normalized_version}'


def build_directory_to_ghcr_mapping(base_images_path: Path) -> Dict[str, Dict[str, str]]:
    """
    Build bidirectional mapping between directories and GHCR tags.

    Args:
        base_images_path: Path to base-images/ directory

    Returns:
        Dictionary with two keys:
        - 'dir_to_ghcr': Maps directory name to GHCR tag
        - 'ghcr_to_dir': Maps GHCR tag to directory name

    Example:
        >>> build_directory_to_ghcr_mapping(Path('base-images'))
        {
            'dir_to_ghcr': {
                'node-18-alpine': 'ghcr.io/groupsky/homy/node:18.20.8-alpine',
                'grafana': 'ghcr.io/groupsky/homy/grafana:9.5.21'
            },
            'ghcr_to_dir': {
                'ghcr.io/groupsky/homy/node:18.20.8-alpine': 'node-18-alpine',
                'ghcr.io/groupsky/homy/grafana:9.5.21': 'grafana'
            }
        }
    """
    dir_to_ghcr = {}
    ghcr_to_dir = {}

    # Discover all base images
    discovered = discover_base_images(base_images_path)

    for img in discovered:
        directory = img['directory']
        raw_version = img['raw_version']

        # Generate normalized GHCR tag
        ghcr_tag = normalize_ghcr_tag(directory, raw_version)

        # Build bidirectional mapping
        dir_to_ghcr[directory] = ghcr_tag
        ghcr_to_dir[ghcr_tag] = directory

    return {
        'dir_to_ghcr': dir_to_ghcr,
        'ghcr_to_dir': ghcr_to_dir
    }
