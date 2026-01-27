"""
GHCR API client for image existence checks.

Interacts with GitHub Container Registry to:
- Check if image tags already exist using docker buildx imagetools inspect
- Avoid rebuilding unchanged images
- Query image metadata with retry logic
- Validate fork PR base image availability
"""

import subprocess
import time
import re
from typing import List, Dict, Any, Tuple


class GHCRError(Exception):
    """Base exception for GHCR-related errors."""
    pass


class GHCRRateLimitError(GHCRError):
    """Exception raised when GHCR rate limit is hit."""
    pass


def check_image_exists(image_tag: str, retries: int = 3) -> bool:
    """
    Check if a Docker image exists in GHCR using docker buildx imagetools inspect.

    Uses docker buildx imagetools inspect command to check if an image exists.
    Implements retry logic with exponential backoff for transient errors.

    Args:
        image_tag: Full image tag (e.g., 'ghcr.io/groupsky/homy/node:18.20.8-alpine')
        retries: Maximum number of retry attempts (default: 3)

    Returns:
        True if image exists, False if not found

    Raises:
        ValueError: If image tag format is invalid
        GHCRRateLimitError: If GHCR rate limit is hit (503)
        GHCRError: If check fails after all retries

    Examples:
        >>> check_image_exists('ghcr.io/groupsky/homy/node:18.20.8-alpine')
        True
        >>> check_image_exists('ghcr.io/groupsky/homy/nonexistent:tag')
        False
    """
    # Validate image tag format
    if not image_tag or not _is_valid_ghcr_tag(image_tag):
        raise ValueError(f"Invalid image tag: {image_tag}")

    attempt = 0
    while attempt < retries:
        try:
            # Execute docker buildx imagetools inspect
            result = subprocess.run(
                ['docker', 'buildx', 'imagetools', 'inspect', image_tag],
                capture_output=True,
                text=True,
                timeout=30
            )

            # Success - image exists
            if result.returncode == 0:
                return True

            # Check error message to determine if it's a "not found" or transient error
            stderr_lower = result.stderr.lower()

            # Check for rate limiting (503)
            if '503' in result.stderr or 'service unavailable' in stderr_lower:
                raise GHCRRateLimitError(
                    f"GHCR rate limit hit while checking {image_tag}. "
                    f"Please wait and try again later."
                )

            # Check for "not found" errors (404-like responses)
            not_found_patterns = [
                'manifest unknown',
                'not found',
                'manifest_unknown',
                'requested access to the resource is denied'
            ]

            if any(pattern in stderr_lower for pattern in not_found_patterns):
                # Image doesn't exist - this is expected, return False
                return False

            # Transient error - should retry
            transient_patterns = [
                'timeout',
                'connection refused',
                'temporary failure',
                'i/o timeout'
            ]

            if any(pattern in stderr_lower for pattern in transient_patterns):
                # This is a transient error, retry with backoff
                attempt += 1
                if attempt < retries:
                    # Exponential backoff: 1s, 2s, 4s, ...
                    sleep_time = 2 ** (attempt - 1)
                    time.sleep(sleep_time)
                    continue
                else:
                    # Max retries reached
                    raise GHCRError(
                        f"Failed after {retries} retries checking {image_tag}: {result.stderr}"
                    )

            # Unknown error - raise immediately
            raise GHCRError(f"Unknown error checking {image_tag}: {result.stderr}")

        except subprocess.TimeoutExpired as e:
            raise GHCRError(f"Subprocess error: Timeout while checking {image_tag}") from e
        except subprocess.SubprocessError as e:
            raise GHCRError(f"Subprocess error checking {image_tag}: {str(e)}") from e

    # Should not reach here, but just in case
    raise GHCRError(f"Failed after {retries} retries checking {image_tag}")


def check_all_services(
    services: List[Dict[str, Any]],
    base_sha: str,
    registry: str = 'ghcr.io/groupsky/homy'
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Check multiple services and determine which need building vs retagging.

    For each service, checks if the image with base_sha tag already exists.
    If it exists, the service can be retagged. If not, it needs to be built.

    Args:
        services: List of service metadata dicts with 'service_name', 'image', etc.
        base_sha: Git SHA to use as image tag (e.g., 'abc123')
        registry: Registry prefix to use (default: 'ghcr.io/groupsky/homy')

    Returns:
        Tuple of (to_build, to_retag):
        - to_build: Services that need building (image doesn't exist)
        - to_retag: Services that can be retagged (image already exists)

    Examples:
        >>> services = [{'service_name': 'broker', 'image': 'ghcr.io/groupsky/homy/mosquitto:latest'}]
        >>> to_build, to_retag = check_all_services(services, 'abc123')
    """
    to_build = []
    to_retag = []

    for service in services:
        # Extract image name from service config
        image = service.get('image', '')

        # Replace tag with base_sha
        # Extract image name without tag and add base_sha
        image_with_sha = _replace_tag_with_sha(image, base_sha, registry)

        # Check if image exists
        try:
            exists = check_image_exists(image_with_sha, retries=3)

            if exists:
                # Image already exists, can be retagged
                to_retag.append(service)
            else:
                # Image doesn't exist, needs building
                to_build.append(service)

        except GHCRError as e:
            # On error, assume needs building (safe default)
            # In production, you might want to log this
            to_build.append(service)

    return to_build, to_retag


def validate_fork_pr_base_images(
    is_fork: bool,
    base_images_needed: List[str]
) -> None:
    """
    Validate that all required base images exist for fork PRs.

    Fork PRs cannot build base images, so they must already exist in GHCR.
    This function checks that all required base images are available.

    Args:
        is_fork: Whether this is a fork PR
        base_images_needed: List of full base image tags needed (e.g., 'ghcr.io/groupsky/homy/node:18.20.8-alpine')

    Raises:
        GHCRError: If fork PR is missing required base images (with helpful error message)

    Examples:
        >>> validate_fork_pr_base_images(False, ['ghcr.io/groupsky/homy/node:18.20.8-alpine'])
        # No check needed for non-fork

        >>> validate_fork_pr_base_images(True, ['ghcr.io/groupsky/homy/node:18.20.8-alpine'])
        # Checks that image exists, raises if not
    """
    # Non-fork PRs can build base images, so no validation needed
    if not is_fork:
        return

    # Empty list is OK
    if not base_images_needed:
        return

    # Check each base image
    missing_images = []

    for image_tag in base_images_needed:
        try:
            exists = check_image_exists(image_tag, retries=3)
            if not exists:
                missing_images.append(image_tag)
        except GHCRError:
            # If check fails, assume missing
            missing_images.append(image_tag)

    # If any images are missing, raise helpful error
    if missing_images:
        error_msg = (
            f"Fork PR cannot proceed: Missing required base images in GHCR.\n\n"
            f"The following base images must be built by a maintainer before this fork PR can build:\n"
        )
        for img in missing_images:
            error_msg += f"  - {img}\n"

        error_msg += (
            f"\nPlease contact a repository maintainer to build these base images first.\n"
            f"Maintainers can trigger base image builds from the main repository."
        )

        raise GHCRError(error_msg)


def _is_valid_ghcr_tag(image_tag: str) -> bool:
    """
    Validate that image tag is a valid GHCR tag format.

    Args:
        image_tag: Image tag to validate

    Returns:
        True if valid GHCR tag format
    """
    if not image_tag:
        return False

    # Must contain ghcr.io/groupsky/homy
    if 'ghcr.io/groupsky/homy' not in image_tag:
        return False

    # Basic format check: registry/org/repo/image:tag
    # Should have at least one slash and one colon
    if '/' not in image_tag or ':' not in image_tag:
        return False

    return True


def _replace_tag_with_sha(image: str, sha: str, registry: str) -> str:
    """
    Replace image tag with SHA.

    Extracts image name from full image path and replaces tag with SHA.

    Args:
        image: Full image path (e.g., 'ghcr.io/groupsky/homy/mosquitto:latest')
        sha: Git SHA to use as tag
        registry: Registry prefix

    Returns:
        Image path with SHA as tag (e.g., 'ghcr.io/groupsky/homy/mosquitto:abc123')

    Examples:
        >>> _replace_tag_with_sha('ghcr.io/groupsky/homy/mosquitto:latest', 'abc123', 'ghcr.io/groupsky/homy')
        'ghcr.io/groupsky/homy/mosquitto:abc123'
    """
    if ':' in image:
        # Split on last colon to handle registry:port format
        image_name = image.rsplit(':', 1)[0]
    else:
        image_name = image

    return f"{image_name}:{sha}"
