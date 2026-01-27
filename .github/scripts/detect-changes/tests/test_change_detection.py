"""
Tests for change_detection.py module.

Tests:
- Detection of changed base image directories via git diff
- Detection of changed service directories via git diff
- Validation of base image Dockerfiles (must be exact copies)
- Handling of edge cases (no changes, git failures)
"""

import subprocess
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

import pytest


class TestDetectChangedBaseImages:
    """Test detection of changed base image directories."""

    def test_detect_changed_base_images_single_change(self, temp_repo):
        """Should detect changed base image directory from git diff."""
        # Setup
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
            {"name": "alpine", "directory": "base-images/alpine"},
        ]

        # Mock git diff output showing change in node base image
        git_output = b"base-images/node/Dockerfile\nbase-images/node/README.md\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            # Verify git diff was called correctly
            mock_run.assert_called_once()
            call_args = mock_run.call_args
            assert 'git' in call_args[0][0]
            assert 'diff' in call_args[0][0]
            assert base_ref in call_args[0][0]
            assert '--name-only' in call_args[0][0]

            # Should return only the changed base image
            assert result == ["node"]

    def test_detect_changed_base_images_multiple_changes(self, temp_repo):
        """Should detect multiple changed base image directories."""
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
            {"name": "alpine", "directory": "base-images/alpine"},
            {"name": "grafana", "directory": "base-images/grafana"},
        ]

        # Mock git diff showing changes in multiple base images
        git_output = b"base-images/node/Dockerfile\nbase-images/alpine/Dockerfile\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            # Should return all changed base images
            assert sorted(result) == ["alpine", "node"]

    def test_detect_changed_base_images_no_changes(self, temp_repo):
        """Should return empty list when no base images changed."""
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
        ]

        # Mock git diff showing no changes
        git_output = b""

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            assert result == []

    def test_detect_changed_base_images_ignores_other_files(self, temp_repo):
        """Should ignore changes outside base-images directory."""
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
        ]

        # Mock git diff showing changes only in non-base-image files
        git_output = b"docker/automations/index.js\nREADME.md\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            assert result == []

    def test_detect_changed_base_images_handles_subdirectories(self, temp_repo):
        """Should match base image even with subdirectory changes."""
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
        ]

        # Mock git diff showing change in subdirectory
        git_output = b"base-images/node/scripts/build.sh\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            assert result == ["node"]


class TestDetectChangedServices:
    """Test detection of changed service directories."""

    def test_detect_changed_services_single_change(self, temp_repo):
        """Should detect changed service directory from git diff."""
        base_ref = "origin/master"
        services = [
            {"name": "automations", "directory": "docker/automations"},
            {"name": "mqtt-influx", "directory": "docker/mqtt-influx"},
        ]

        # Mock git diff showing change in automations service
        git_output = b"docker/automations/index.js\ndocker/automations/Dockerfile\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_services

            result = detect_changed_services(base_ref, services)

            # Verify git diff was called
            mock_run.assert_called_once()

            # Should return only the changed service
            assert result == ["automations"]

    def test_detect_changed_services_multiple_changes(self, temp_repo):
        """Should detect multiple changed service directories."""
        base_ref = "origin/master"
        services = [
            {"name": "automations", "directory": "docker/automations"},
            {"name": "mqtt-influx", "directory": "docker/mqtt-influx"},
            {"name": "ha-discovery", "directory": "docker/ha-discovery"},
        ]

        # Mock git diff showing changes in multiple services
        git_output = b"docker/automations/index.js\ndocker/ha-discovery/discover.js\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_services

            result = detect_changed_services(base_ref, services)

            assert sorted(result) == ["automations", "ha-discovery"]

    def test_detect_changed_services_no_changes(self, temp_repo):
        """Should return empty list when no services changed."""
        base_ref = "origin/master"
        services = [
            {"name": "automations", "directory": "docker/automations"},
        ]

        git_output = b""

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_services

            result = detect_changed_services(base_ref, services)

            assert result == []

    def test_detect_changed_services_ignores_other_files(self, temp_repo):
        """Should ignore changes outside docker directory."""
        base_ref = "origin/master"
        services = [
            {"name": "automations", "directory": "docker/automations"},
        ]

        # Mock git diff showing changes only in non-service files
        git_output = b"base-images/node/Dockerfile\nREADME.md\n"

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=git_output, returncode=0)

            from change_detection import detect_changed_services

            result = detect_changed_services(base_ref, services)

            assert result == []


class TestValidateBaseImageExactCopy:
    """Test validation of base image Dockerfiles."""

    def test_validate_base_image_exact_copy_valid_from_only(self, temp_repo):
        """Should pass for Dockerfile with only FROM statement."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text("FROM node:18.20.8-alpine\n")

        from change_detection import validate_base_image_exact_copy

        # Should not raise exception
        validate_base_image_exact_copy(str(dockerfile))

    def test_validate_base_image_exact_copy_valid_with_label(self, temp_repo):
        """Should pass for Dockerfile with FROM and LABEL."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "FROM node:18.20.8-alpine\n"
            "LABEL maintainer=\"test@example.com\"\n"
        )

        from change_detection import validate_base_image_exact_copy

        # Should not raise exception
        validate_base_image_exact_copy(str(dockerfile))

    def test_validate_base_image_exact_copy_valid_with_comments(self, temp_repo):
        """Should pass for Dockerfile with comments."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "# This is a comment\n"
            "FROM node:18.20.8-alpine\n"
            "# Another comment\n"
        )

        from change_detection import validate_base_image_exact_copy

        # Should not raise exception
        validate_base_image_exact_copy(str(dockerfile))

    def test_validate_base_image_exact_copy_fails_with_run(self, temp_repo):
        """Should fail for Dockerfile with RUN instruction."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "FROM node:18.20.8-alpine\n"
            "RUN apk add --no-cache curl\n"
        )

        from change_detection import validate_base_image_exact_copy, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_base_image_exact_copy(str(dockerfile))

        assert "RUN" in str(exc_info.value)
        assert "exact copies" in str(exc_info.value).lower()

    def test_validate_base_image_exact_copy_fails_with_copy(self, temp_repo):
        """Should fail for Dockerfile with COPY instruction."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "FROM node:18.20.8-alpine\n"
            "COPY script.sh /usr/local/bin/\n"
        )

        from change_detection import validate_base_image_exact_copy, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_base_image_exact_copy(str(dockerfile))

        assert "COPY" in str(exc_info.value)

    def test_validate_base_image_exact_copy_fails_with_add(self, temp_repo):
        """Should fail for Dockerfile with ADD instruction."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "FROM node:18.20.8-alpine\n"
            "ADD archive.tar.gz /app/\n"
        )

        from change_detection import validate_base_image_exact_copy, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_base_image_exact_copy(str(dockerfile))

        assert "ADD" in str(exc_info.value)

    def test_validate_base_image_exact_copy_fails_with_workdir(self, temp_repo):
        """Should fail for Dockerfile with WORKDIR instruction."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "FROM node:18.20.8-alpine\n"
            "WORKDIR /app\n"
        )

        from change_detection import validate_base_image_exact_copy, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_base_image_exact_copy(str(dockerfile))

        assert "WORKDIR" in str(exc_info.value)

    def test_validate_base_image_exact_copy_clear_error_message(self, temp_repo):
        """Should provide clear error message with instruction details."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"
        dockerfile.parent.mkdir(parents=True, exist_ok=True)
        dockerfile.write_text(
            "FROM node:18.20.8-alpine\n"
            "RUN npm install -g yarn\n"
            "COPY package.json /app/\n"
        )

        from change_detection import validate_base_image_exact_copy, ValidationError

        with pytest.raises(ValidationError) as exc_info:
            validate_base_image_exact_copy(str(dockerfile))

        error_msg = str(exc_info.value)
        # Should mention which instructions are forbidden
        assert "RUN" in error_msg or "COPY" in error_msg
        # Should explain the requirement
        assert "exact copies" in error_msg.lower() or "mirror" in error_msg.lower()


class TestHandleNoChanges:
    """Test handling of scenarios with no changes."""

    def test_detect_changed_base_images_empty_git_output(self, temp_repo):
        """Should return empty list when git diff returns nothing."""
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
        ]

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=b"", returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            assert result == []

    def test_detect_changed_services_empty_git_output(self, temp_repo):
        """Should return empty list when git diff returns nothing."""
        base_ref = "origin/master"
        services = [
            {"name": "automations", "directory": "docker/automations"},
        ]

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=b"", returncode=0)

            from change_detection import detect_changed_services

            result = detect_changed_services(base_ref, services)

            assert result == []

    def test_detect_changed_base_images_empty_base_images_list(self, temp_repo):
        """Should handle empty base images list gracefully."""
        base_ref = "origin/master"
        base_images = []

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=b"base-images/node/Dockerfile\n", returncode=0)

            from change_detection import detect_changed_base_images

            result = detect_changed_base_images(base_ref, base_images)

            assert result == []

    def test_detect_changed_services_empty_services_list(self, temp_repo):
        """Should handle empty services list gracefully."""
        base_ref = "origin/master"
        services = []

        with patch('subprocess.run') as mock_run:
            mock_run.return_value = Mock(stdout=b"docker/automations/index.js\n", returncode=0)

            from change_detection import detect_changed_services

            result = detect_changed_services(base_ref, services)

            assert result == []


class TestHandleGitCommandFailures:
    """Test handling of git command failures."""

    def test_detect_changed_base_images_git_error(self, temp_repo):
        """Should handle git command errors gracefully."""
        base_ref = "origin/master"
        base_images = [
            {"name": "node", "directory": "base-images/node"},
        ]

        with patch('subprocess.run') as mock_run:
            # Simulate git command failure
            mock_run.side_effect = subprocess.CalledProcessError(128, 'git')

            from change_detection import detect_changed_base_images

            with pytest.raises(subprocess.CalledProcessError):
                detect_changed_base_images(base_ref, base_images)

    def test_detect_changed_services_git_error(self, temp_repo):
        """Should handle git command errors gracefully."""
        base_ref = "origin/master"
        services = [
            {"name": "automations", "directory": "docker/automations"},
        ]

        with patch('subprocess.run') as mock_run:
            # Simulate git command failure
            mock_run.side_effect = subprocess.CalledProcessError(128, 'git')

            from change_detection import detect_changed_services

            with pytest.raises(subprocess.CalledProcessError):
                detect_changed_services(base_ref, services)

    def test_validate_base_image_file_not_found(self, temp_repo):
        """Should handle missing Dockerfile gracefully."""
        dockerfile = temp_repo / "base-images" / "node" / "Dockerfile"

        from change_detection import validate_base_image_exact_copy

        with pytest.raises(FileNotFoundError):
            validate_base_image_exact_copy(str(dockerfile))
