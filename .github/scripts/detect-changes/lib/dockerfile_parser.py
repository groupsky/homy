"""
Dockerfile parsing and dependency extraction.

Parses Dockerfile content to extract:
- Base image references (FROM statements)
- HEALTHCHECK instructions and parameters
- External image dependencies (COPY --from)
- Validation rules (no ARG in FROM)
- Base image upstream information
"""

from typing import Dict, List, Optional
from dockerfile_parse import DockerfileParser


class ValidationError(Exception):
    """Raised when Dockerfile validation fails."""
    pass


def parse_from_lines(dockerfile_content: str) -> List[Dict[str, Optional[str]]]:
    """
    Extract all FROM lines from a Dockerfile.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Returns:
        List of dictionaries with keys:
        - 'image': The base image name (required)
        - 'stage': The stage name if using AS keyword (optional)
        - 'platform': The platform if using --platform flag (optional)

    Example:
        >>> parse_from_lines('FROM node:18 AS base')
        [{'image': 'node:18', 'stage': 'base', 'platform': None}]
    """
    if not dockerfile_content or not dockerfile_content.strip():
        return []

    parser = DockerfileParser()
    parser.content = dockerfile_content

    result = []

    for instruction in parser.structure:
        if instruction['instruction'].upper() == 'FROM':
            value = instruction['value']

            # Skip malformed FROM lines
            if not value or not value.strip():
                continue

            parts = value.split()

            # Handle --platform flag
            platform = None
            image_idx = 0

            if parts and parts[0].startswith('--platform='):
                platform = parts[0].split('=', 1)[1]
                image_idx = 1

            if len(parts) <= image_idx:
                continue  # Malformed

            image = parts[image_idx]

            # Handle AS keyword for stage names
            stage = None
            if len(parts) > image_idx + 1 and parts[image_idx + 1].upper() == 'AS':
                if len(parts) > image_idx + 2:
                    stage = parts[image_idx + 2]

            result.append({
                'image': image,
                'stage': stage,
                'platform': platform
            })

    return result


def extract_final_stage_base(dockerfile_content: str) -> Optional[str]:
    """
    Extract the ultimate external base image for the final stage.

    Follows internal stage references to find the actual external base image.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Returns:
        The external base image used by the final stage, or None if not found

    Example:
        >>> extract_final_stage_base('FROM node:18 AS base\\nFROM base AS final')
        'node:18'
    """
    from_lines = parse_from_lines(dockerfile_content)

    if not from_lines:
        return None

    # Build a map of stage names to their base images
    stage_map = {}
    for from_line in from_lines:
        if from_line['stage']:
            stage_map[from_line['stage']] = from_line['image']

    # Get the final stage's image
    final_image = from_lines[-1]['image']

    # Follow the chain to find the external base
    visited = set()
    current = final_image

    while current in stage_map and current not in visited:
        visited.add(current)
        current = stage_map[current]

    return current


def has_healthcheck(dockerfile_content: str) -> bool:
    """
    Check if the final stage has a HEALTHCHECK instruction.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Returns:
        True if HEALTHCHECK exists in final stage, False otherwise

    Note:
        HEALTHCHECK NONE is treated as disabled (returns False)
    """
    if not dockerfile_content:
        return False

    parser = DockerfileParser()
    parser.content = dockerfile_content

    # Find the last FROM instruction to identify final stage
    last_from_idx = -1
    for i, instruction in enumerate(parser.structure):
        if instruction['instruction'].upper() == 'FROM':
            last_from_idx = i

    if last_from_idx == -1:
        return False

    # Look for HEALTHCHECK after the last FROM
    for i in range(last_from_idx + 1, len(parser.structure)):
        instruction = parser.structure[i]
        if instruction['instruction'].upper() == 'HEALTHCHECK':
            value = instruction['value'].strip()
            # HEALTHCHECK NONE disables health checks
            if value.upper() == 'NONE':
                return False
            return True

    return False


def parse_healthcheck_params(dockerfile_content: str) -> Optional[Dict[str, Optional[str]]]:
    """
    Extract HEALTHCHECK parameters from the final stage.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Returns:
        Dictionary with keys: interval, timeout, start_period, retries, cmd
        Returns None if no HEALTHCHECK instruction found

    Example:
        >>> parse_healthcheck_params('FROM node\\nHEALTHCHECK --interval=30s CMD echo ok')
        {'interval': '30s', 'timeout': None, 'start_period': None, 'retries': None, 'cmd': 'echo ok'}
    """
    if not dockerfile_content:
        return None

    parser = DockerfileParser()
    parser.content = dockerfile_content

    # Find the last FROM instruction to identify final stage
    last_from_idx = -1
    for i, instruction in enumerate(parser.structure):
        if instruction['instruction'].upper() == 'FROM':
            last_from_idx = i

    if last_from_idx == -1:
        return None

    # Look for HEALTHCHECK after the last FROM
    for i in range(last_from_idx + 1, len(parser.structure)):
        instruction = parser.structure[i]
        if instruction['instruction'].upper() == 'HEALTHCHECK':
            value = instruction['value'].strip()

            # HEALTHCHECK NONE has no parameters
            if value.upper() == 'NONE':
                return None

            result = {
                'interval': None,
                'timeout': None,
                'start_period': None,
                'retries': None,
                'cmd': None
            }

            # Parse the value to extract parameters
            parts = []
            current = []
            in_quotes = False

            for char in value:
                if char in ('"', "'"):
                    in_quotes = not in_quotes
                    current.append(char)
                elif char == ' ' and not in_quotes:
                    if current:
                        parts.append(''.join(current))
                        current = []
                else:
                    current.append(char)

            if current:
                parts.append(''.join(current))

            # Extract flags and CMD
            cmd_parts = []
            i = 0
            while i < len(parts):
                part = parts[i]

                if part.startswith('--interval='):
                    result['interval'] = part.split('=', 1)[1]
                elif part.startswith('--timeout='):
                    result['timeout'] = part.split('=', 1)[1]
                elif part.startswith('--start-period='):
                    result['start_period'] = part.split('=', 1)[1]
                elif part.startswith('--retries='):
                    result['retries'] = part.split('=', 1)[1]
                elif part.upper() == 'CMD':
                    # Everything after CMD is the command
                    cmd_parts = parts[i+1:]
                    break
                else:
                    cmd_parts.append(part)

                i += 1

            if cmd_parts:
                result['cmd'] = ' '.join(cmd_parts)

            return result

    return None


def extract_copy_from_external(dockerfile_content: str) -> List[str]:
    """
    Extract external images used in COPY --from statements.

    Internal stage references are filtered out.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Returns:
        List of unique external image names

    Example:
        >>> extract_copy_from_external('COPY --from=node:18 /app /app')
        ['node:18']
    """
    if not dockerfile_content:
        return []

    parser = DockerfileParser()
    parser.content = dockerfile_content

    # Get all stage names to filter them out
    from_lines = parse_from_lines(dockerfile_content)
    stage_names = {line['stage'] for line in from_lines if line['stage']}

    external_images = set()

    for instruction in parser.structure:
        if instruction['instruction'].upper() == 'COPY':
            value = instruction['value']

            # Look for --from= flag
            if '--from=' in value:
                # Extract the image name from --from=image
                parts = value.split()
                for part in parts:
                    if part.startswith('--from='):
                        image = part.split('=', 1)[1]
                        # Only include if it's not an internal stage
                        if image not in stage_names:
                            external_images.add(image)
                        break

    return list(external_images)


def validate_no_arg_in_from(dockerfile_content: str) -> None:
    """
    Validate that FROM lines don't use ARG variables.

    Raises ValidationError if variable substitution is detected in FROM.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Raises:
        ValidationError: If ARG variable is used in FROM line

    Example:
        >>> validate_no_arg_in_from('FROM node:18')  # OK
        >>> validate_no_arg_in_from('FROM node:${VERSION}')  # Raises
    """
    from_lines = parse_from_lines(dockerfile_content)

    for from_line in from_lines:
        image = from_line['image']

        # Check for variable substitution patterns
        if '$' in image:
            raise ValidationError(
                f"FROM line contains variable substitution: {image}. "
                "ARG variables in FROM statements are not allowed."
            )


def parse_base_image_dockerfile(dockerfile_content: str) -> Optional[Dict[str, Optional[str]]]:
    """
    Parse a base image Dockerfile to extract upstream image information.

    This is used for base-images/ directory Dockerfiles to track upstream images.

    Args:
        dockerfile_content: The Dockerfile content as a string

    Returns:
        Dictionary with keys:
        - 'upstream_image': Full upstream image reference
        - 'image_name': Just the image name (without registry/tag)
        - 'version_tag': The version tag, or None/latest if not specified

    Example:
        >>> parse_base_image_dockerfile('FROM node:18.20.8-alpine')
        {'upstream_image': 'node:18.20.8-alpine', 'image_name': 'node', 'version_tag': '18.20.8-alpine'}
    """
    from_lines = parse_from_lines(dockerfile_content)

    if not from_lines:
        return None

    # Use the first external FROM (skip internal stage references)
    upstream_image = None
    for from_line in from_lines:
        image = from_line['image']
        # If it doesn't look like a stage reference (no dots, slashes, or colons typically means it's a stage)
        # But actually, we should just use the first one since base images are simple
        upstream_image = image
        break

    if not upstream_image:
        return None

    # Parse the image name and tag
    # Format: [registry/]image[:tag]

    # Remove registry if present
    image_without_registry = upstream_image
    if '/' in upstream_image:
        parts = upstream_image.split('/')
        # Check if first part looks like a registry (has dot or is localhost)
        if '.' in parts[0] or ':' in parts[0] or parts[0] == 'localhost':
            # This is a registry, remove it
            image_without_registry = '/'.join(parts[1:])
        else:
            # Not a registry, keep as is
            image_without_registry = upstream_image

    # Extract version tag
    if ':' in image_without_registry:
        image_name, version_tag = image_without_registry.rsplit(':', 1)
    else:
        image_name = image_without_registry
        version_tag = None

    # For images with registry, use the part after registry for image_name
    if '/' in upstream_image:
        parts = upstream_image.split('/')
        if '.' in parts[0] or ':' in parts[0] or parts[0] == 'localhost':
            # Has registry
            rest = '/'.join(parts[1:])
            if ':' in rest:
                image_name = rest.rsplit(':', 1)[0]
            else:
                image_name = rest

    return {
        'upstream_image': upstream_image,
        'image_name': image_name,
        'version_tag': version_tag
    }
