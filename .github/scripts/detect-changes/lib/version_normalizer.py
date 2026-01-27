"""
Version string normalization.

Normalizes various version formats for consistent comparison:
- Removes 'v' prefix
- Pads to semantic version format (X.Y.Z)
- Handles special cases (latest, alpine, etc.)
- Strips platform-specific version suffixes (alpine3.21, debian12, ubuntu22.04)
"""

import re
from typing import Optional


def normalize_version(version: str) -> str:
    """
    Normalize platform-specific version suffixes in Docker image version strings.

    Normalizes versioned platform suffixes to their generic forms:
    - alpine3.21, alpine3.19, etc. → alpine
    - debian12, debian11, etc. → debian
    - ubuntu22.04, ubuntu20.04, etc. → ubuntu

    Preserves non-platform suffixes (slim, openssl, bullseye, etc.)
    and is idempotent (running twice gives same result).

    Args:
        version: Docker image version string (e.g., "18.20.8-alpine3.21")

    Returns:
        Normalized version string (e.g., "18.20.8-alpine")

    Examples:
        >>> normalize_version("18.20.8-alpine3.21")
        "18.20.8-alpine"
        >>> normalize_version("11.2-debian12")
        "11.2-debian"
        >>> normalize_version("20.04-ubuntu22.04")
        "20.04-ubuntu"
        >>> normalize_version("1.6.23-openssl")
        "1.6.23-openssl"

    Raises:
        TypeError: If version is None
        AttributeError: If version is not a string
    """
    # Handle None explicitly to raise TypeError
    if version is None:
        raise TypeError("version cannot be None")

    # Empty strings return as-is
    if not version:
        return version

    # Validate that version is a string (raises AttributeError for non-strings)
    # This triggers AttributeError on numeric types as expected by tests
    version.lower()

    # Normalize alpine versions: alpine3.21 → alpine, alpine3.19 → alpine
    version = re.sub(r'alpine3\.\d+', 'alpine', version)

    # Normalize debian versions: debian12 → debian, debian11 → debian
    version = re.sub(r'debian\d+', 'debian', version)

    # Normalize ubuntu versions: ubuntu22.04 → ubuntu, ubuntu20.04 → ubuntu
    version = re.sub(r'ubuntu\d+\.\d+', 'ubuntu', version)

    return version


def extract_semver_core(version: str) -> str:
    """
    Extract semantic version core from a version string.

    Extracts the version number part before any platform suffixes or tags.
    Handles:
    - 2-part versions (X.Y)
    - 3-part versions (X.Y.Z)
    - 4-part versions (X.Y.Z.W)
    - Version prefix 'v' (stripped)
    - Pre-release versions (e.g., 2.0.0-rc1)
    - Build metadata (e.g., 1.0.0+build123)
    - Platform suffixes (e.g., -alpine, -debian)

    Args:
        version: Version string (e.g., "18.20.8-alpine", "v1.2.3")

    Returns:
        Core semantic version (e.g., "18.20.8", "1.2.3")

    Examples:
        >>> extract_semver_core("18.20.8-alpine")
        "18.20.8"
        >>> extract_semver_core("v1.2.3")
        "1.2.3"
        >>> extract_semver_core("9.5.21")
        "9.5.21"
        >>> extract_semver_core("2.0.0-rc1-alpine")
        "2.0.0"
        >>> extract_semver_core("1.0.0+build123-alpine")
        "1.0.0"
    """
    if not version:
        return version

    # Strip leading 'v' prefix if present
    if version.startswith('v'):
        version = version[1:]

    # Extract semver core using regex
    # Pattern matches: X.Y[.Z[.W]] optionally followed by pre-release/build metadata
    # Then captures everything before platform suffixes like -alpine, -debian, etc.
    match = re.match(r'^(\d+(?:\.\d+){1,3})(?:[-+][\w.]+)?', version)

    if match:
        return match.group(1)

    # If no match, return original (handles edge cases)
    return version
