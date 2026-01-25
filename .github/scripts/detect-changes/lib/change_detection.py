"""
File change to image mapping logic.

Determines which images are affected by file changes:
- Maps changed files to base images
- Maps changed files to services
- Validates base image Dockerfiles are exact copies
"""

import subprocess
from pathlib import Path
from typing import List, Dict


class ValidationError(Exception):
    """Raised when validation fails."""
    pass


def detect_changed_base_images(base_ref: str, base_images: List[Dict[str, str]]) -> List[str]:
    """
    Detect which base images have changed compared to base_ref.

    Uses git diff to find changed files, then maps them to base image directories.

    Args:
        base_ref: Git reference to compare against (e.g., 'origin/master')
        base_images: List of base image dicts with 'name' and 'directory' keys

    Returns:
        List of base image names that have changes

    Raises:
        subprocess.CalledProcessError: If git command fails
    """
    # Run git diff to get list of changed files
    result = subprocess.run(
        ['git', 'diff', '--name-only', base_ref, 'HEAD'],
        stdout=subprocess.PIPE,
        check=True
    )

    # Parse changed files from git output
    changed_files = result.stdout.decode('utf-8').strip().split('\n')
    if changed_files == ['']:
        changed_files = []

    # Find which base images are affected
    changed_base_images = set()
    for base_image in base_images:
        directory = base_image['directory']
        for file_path in changed_files:
            if file_path.startswith(directory + '/'):
                changed_base_images.add(base_image['name'])
                break

    return sorted(list(changed_base_images))


def detect_changed_services(base_ref: str, services: List[Dict[str, str]]) -> List[str]:
    """
    Detect which services have changed compared to base_ref.

    Uses git diff to find changed files, then maps them to service directories.

    Args:
        base_ref: Git reference to compare against (e.g., 'origin/master')
        services: List of service dicts with 'name' and 'directory' keys

    Returns:
        List of service names that have changes

    Raises:
        subprocess.CalledProcessError: If git command fails
    """
    # Run git diff to get list of changed files
    result = subprocess.run(
        ['git', 'diff', '--name-only', base_ref, 'HEAD'],
        stdout=subprocess.PIPE,
        check=True
    )

    # Parse changed files from git output
    changed_files = result.stdout.decode('utf-8').strip().split('\n')
    if changed_files == ['']:
        changed_files = []

    # Find which services are affected
    changed_services = set()
    for service in services:
        directory = service['directory']
        for file_path in changed_files:
            if file_path.startswith(directory + '/'):
                changed_services.add(service['name'])
                break

    return sorted(list(changed_services))


def validate_base_image_exact_copy(dockerfile_path: str) -> None:
    """
    Validate that a base image Dockerfile is an exact copy.

    Base images should only contain FROM and optionally LABEL instructions.
    They should not contain RUN, COPY, ADD, WORKDIR, or other build instructions.

    Args:
        dockerfile_path: Path to Dockerfile to validate

    Raises:
        FileNotFoundError: If Dockerfile doesn't exist
        ValidationError: If Dockerfile contains forbidden instructions
    """
    path = Path(dockerfile_path)

    # Read and validate file exists
    content = path.read_text()

    # Parse Dockerfile instructions
    forbidden_instructions = {'RUN', 'COPY', 'ADD', 'WORKDIR', 'CMD', 'ENTRYPOINT',
                             'ENV', 'EXPOSE', 'USER', 'VOLUME', 'HEALTHCHECK'}

    for line in content.split('\n'):
        # Strip whitespace and skip empty lines and comments
        line = line.strip()
        if not line or line.startswith('#'):
            continue

        # Check for forbidden instructions
        instruction = line.split()[0].upper() if line.split() else ''
        if instruction in forbidden_instructions:
            raise ValidationError(
                f"Base image Dockerfile contains forbidden instruction '{instruction}'. "
                f"Base images must be exact copies containing only FROM and optionally LABEL instructions. "
                f"Found in: {dockerfile_path}"
            )
