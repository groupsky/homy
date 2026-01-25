"""
Tests for base_images.py module.

Tests:
- Base image discovery from base-images.yml
- Dockerfile path resolution
- Version parsing and normalization
- Configuration validation
"""

import pytest


class TestBaseImageDiscovery:
    """Test base image discovery functionality."""

    def test_parse_base_images_config(self):
        """Test parsing base-images.yml configuration."""
        # TODO: Implement test
        pass

    def test_discover_base_image_dockerfiles(self):
        """Test discovering Dockerfiles in base-images/ directory."""
        # TODO: Implement test
        pass

    def test_resolve_base_image_paths(self):
        """Test resolving base image Dockerfile paths."""
        # TODO: Implement test
        pass


class TestBaseImageValidation:
    """Test base image configuration validation."""

    def test_validate_base_images_config(self):
        """Test validation of base-images.yml structure."""
        # TODO: Implement test
        pass

    def test_detect_missing_dockerfiles(self):
        """Test detection of configured images without Dockerfiles."""
        # TODO: Implement test
        pass
