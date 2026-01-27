"""
Tests for ghcr_client.py module.

This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
for the GHCR client module BEFORE implementation. All tests will initially FAIL (red phase)
until the implementation is complete.

The ghcr_client module is responsible for:
1. Checking if Docker images exist in GHCR using docker buildx imagetools inspect
2. Implementing retry logic with exponential backoff for transient errors
3. Checking multiple services and determining which need building vs retagging
4. Validating fork PR base images and providing helpful error messages
5. Handling rate limiting and other API errors gracefully
"""

import pytest
from unittest.mock import patch, MagicMock
import subprocess
from lib.ghcr_client import (
    check_image_exists,
    check_all_services,
    validate_fork_pr_base_images,
    GHCRError,
    GHCRRateLimitError,
)


class TestCheckImageExists:
    """Test image existence checking functionality."""

    @patch('subprocess.run')
    def test_check_image_exists_returns_true_when_exists(self, mock_run):
        """Should return True when docker buildx imagetools inspect succeeds."""
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="Name:      ghcr.io/groupsky/homy/node:18.20.8-alpine\nMediaType: application/vnd.docker.distribution.manifest.v2+json",
            stderr=""
        )

        result = check_image_exists('ghcr.io/groupsky/homy/node:18.20.8-alpine')

        assert result is True
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert 'docker' in call_args
        assert 'buildx' in call_args
        assert 'imagetools' in call_args
        assert 'inspect' in call_args
        assert 'ghcr.io/groupsky/homy/node:18.20.8-alpine' in call_args

    @patch('subprocess.run')
    def test_check_image_exists_returns_false_when_not_found(self, mock_run):
        """Should return False when docker buildx imagetools inspect returns 404-like error."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="ERROR: manifest unknown: manifest unknown"
        )

        result = check_image_exists('ghcr.io/groupsky/homy/nonexistent:latest')

        assert result is False

    @patch('subprocess.run')
    def test_check_image_exists_returns_false_on_not_found_error(self, mock_run):
        """Should return False when image is not found (various error patterns)."""
        # Test different error message patterns
        error_patterns = [
            "manifest unknown",
            "not found",
            "MANIFEST_UNKNOWN",
            "requested access to the resource is denied"
        ]

        for error_msg in error_patterns:
            mock_run.return_value = MagicMock(
                returncode=1,
                stdout="",
                stderr=f"ERROR: {error_msg}"
            )

            result = check_image_exists('ghcr.io/groupsky/homy/test:tag')
            assert result is False, f"Should return False for error: {error_msg}"

    @patch('subprocess.run')
    @patch('time.sleep')  # Mock sleep to speed up tests
    def test_check_image_exists_retries_on_transient_errors(self, mock_sleep, mock_run):
        """Should retry up to 3 times on transient errors with exponential backoff."""
        # First two calls fail with transient error, third succeeds
        mock_run.side_effect = [
            MagicMock(returncode=1, stdout="", stderr="ERROR: connection timeout"),
            MagicMock(returncode=1, stdout="", stderr="ERROR: connection timeout"),
            MagicMock(
                returncode=0,
                stdout="Name: ghcr.io/groupsky/homy/node:18.20.8-alpine",
                stderr=""
            )
        ]

        result = check_image_exists('ghcr.io/groupsky/homy/node:18.20.8-alpine', retries=3)

        assert result is True
        assert mock_run.call_count == 3

        # Verify exponential backoff: 1s, 2s
        assert mock_sleep.call_count == 2
        sleep_calls = [call[0][0] for call in mock_sleep.call_args_list]
        assert sleep_calls[0] == 1  # First retry after 1s
        assert sleep_calls[1] == 2  # Second retry after 2s

    @patch('subprocess.run')
    @patch('time.sleep')
    def test_check_image_exists_gives_up_after_max_retries(self, mock_sleep, mock_run):
        """Should give up after maximum retries and raise exception."""
        # All calls fail with transient error
        mock_run.side_effect = [
            MagicMock(returncode=1, stdout="", stderr="ERROR: connection timeout"),
            MagicMock(returncode=1, stdout="", stderr="ERROR: connection timeout"),
            MagicMock(returncode=1, stdout="", stderr="ERROR: connection timeout"),
        ]

        with pytest.raises(GHCRError, match="Failed after 3 retries"):
            check_image_exists('ghcr.io/groupsky/homy/node:18.20.8-alpine', retries=3)

        assert mock_run.call_count == 3

    @patch('subprocess.run')
    def test_check_image_exists_handles_503_gracefully(self, mock_run):
        """Should handle GHCR rate limit (503) with clear error message."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stdout="",
            stderr="ERROR: 503 Service Unavailable"
        )

        with pytest.raises(GHCRRateLimitError, match="GHCR rate limit"):
            check_image_exists('ghcr.io/groupsky/homy/node:18.20.8-alpine', retries=1)

    @patch('subprocess.run')
    def test_check_image_exists_validates_image_format(self, mock_run):
        """Should validate image tag format before making API call."""
        invalid_tags = [
            '',
            'invalid',
            'no-registry/image:tag',
            'ghcr.io/wrong-org/image:tag',
        ]

        for tag in invalid_tags:
            with pytest.raises(ValueError, match="Invalid image tag"):
                check_image_exists(tag)

        # Should not make any subprocess calls for invalid tags
        mock_run.assert_not_called()

    @patch('subprocess.run')
    def test_check_image_exists_handles_subprocess_errors(self, mock_run):
        """Should handle subprocess errors gracefully."""
        mock_run.side_effect = subprocess.TimeoutExpired('docker', 30)

        with pytest.raises(GHCRError, match="Subprocess error"):
            check_image_exists('ghcr.io/groupsky/homy/node:18.20.8-alpine', retries=1)


class TestCheckAllServices:
    """Test batch checking of multiple services."""

    @patch('lib.ghcr_client.check_image_exists')
    def test_check_all_services(self, mock_check):
        """Should check multiple services and return (to_build, to_retag) tuples."""
        services = [
            {
                'service_name': 'broker',
                'image': 'ghcr.io/groupsky/homy/mosquitto:latest',
                'dockerfile_path': 'docker/mosquitto/Dockerfile'
            },
            {
                'service_name': 'automations',
                'image': 'ghcr.io/groupsky/homy/automations:latest',
                'dockerfile_path': 'docker/automations/Dockerfile'
            },
            {
                'service_name': 'grafana',
                'image': 'ghcr.io/groupsky/homy/grafana:latest',
                'dockerfile_path': 'docker/grafana/Dockerfile'
            }
        ]

        # broker exists, automations doesn't exist, grafana exists
        mock_check.side_effect = [True, False, True]

        to_build, to_retag = check_all_services(services, base_sha='abc123')

        # automations needs building (doesn't exist)
        assert len(to_build) == 1
        assert to_build[0]['service_name'] == 'automations'

        # broker and grafana can be retagged (already exist)
        assert len(to_retag) == 2
        retag_names = {s['service_name'] for s in to_retag}
        assert 'broker' in retag_names
        assert 'grafana' in retag_names

        # Verify correct tags were checked (with base_sha)
        expected_calls = [
            'ghcr.io/groupsky/homy/mosquitto:abc123',
            'ghcr.io/groupsky/homy/automations:abc123',
            'ghcr.io/groupsky/homy/grafana:abc123',
        ]
        actual_calls = [call[0][0] for call in mock_check.call_args_list]
        assert actual_calls == expected_calls

    @patch('lib.ghcr_client.check_image_exists')
    def test_check_all_services_with_custom_registry(self, mock_check):
        """Should support custom registry parameter."""
        services = [
            {
                'service_name': 'test',
                'image': 'custom.io/org/test:latest',
                'dockerfile_path': 'docker/test/Dockerfile'
            }
        ]

        mock_check.return_value = False

        to_build, to_retag = check_all_services(
            services,
            base_sha='abc123',
            registry='custom.io/org'
        )

        # Should check with custom registry
        mock_check.assert_called_once_with('custom.io/org/test:abc123', retries=3)

    @patch('lib.ghcr_client.check_image_exists')
    def test_check_all_services_handles_empty_list(self, mock_check):
        """Should handle empty service list gracefully."""
        to_build, to_retag = check_all_services([], base_sha='abc123')

        assert to_build == []
        assert to_retag == []
        mock_check.assert_not_called()

    @patch('lib.ghcr_client.check_image_exists')
    def test_check_all_services_replaces_tag_with_sha(self, mock_check):
        """Should replace :latest tag with :sha when checking existence."""
        services = [
            {
                'service_name': 'broker',
                'image': 'ghcr.io/groupsky/homy/mosquitto:latest',
                'dockerfile_path': 'docker/mosquitto/Dockerfile'
            },
            {
                'service_name': 'automations',
                'image': 'ghcr.io/groupsky/homy/automations:dev',
                'dockerfile_path': 'docker/automations/Dockerfile'
            }
        ]

        mock_check.side_effect = [True, False]

        check_all_services(services, base_sha='deadbeef')

        # Should replace both :latest and :dev with :deadbeef
        expected_calls = [
            'ghcr.io/groupsky/homy/mosquitto:deadbeef',
            'ghcr.io/groupsky/homy/automations:deadbeef',
        ]
        actual_calls = [call[0][0] for call in mock_check.call_args_list]
        assert actual_calls == expected_calls


class TestValidateForkPRBaseImages:
    """Test fork PR base image validation."""

    @patch('lib.ghcr_client.check_image_exists')
    def test_validate_fork_pr_base_images_passes_when_not_fork(self, mock_check):
        """Should pass validation when not a fork (no check needed)."""
        base_images = ['ghcr.io/groupsky/homy/node:18.20.8-alpine']

        # Should not raise and not check images for non-fork
        validate_fork_pr_base_images(is_fork=False, base_images_needed=base_images)

        mock_check.assert_not_called()

    @patch('lib.ghcr_client.check_image_exists')
    def test_validate_fork_pr_base_images_passes_when_fork_with_images(self, mock_check):
        """Should pass validation when fork PR and all base images exist."""
        base_images = [
            'ghcr.io/groupsky/homy/node:18.20.8-alpine',
            'ghcr.io/groupsky/homy/alpine:3.18'
        ]

        # All images exist
        mock_check.return_value = True

        validate_fork_pr_base_images(is_fork=True, base_images_needed=base_images)

        assert mock_check.call_count == 2

    @patch('lib.ghcr_client.check_image_exists')
    def test_validate_fork_pr_base_images_fails_with_helpful_error(self, mock_check):
        """Should fail with helpful error when fork PR missing base images."""
        base_images = [
            'ghcr.io/groupsky/homy/node:18.20.8-alpine',
            'ghcr.io/groupsky/homy/alpine:3.18',
            'ghcr.io/groupsky/homy/nginx:1.25.0'
        ]

        # First exists, second and third don't
        mock_check.side_effect = [True, False, False]

        with pytest.raises(GHCRError) as exc_info:
            validate_fork_pr_base_images(is_fork=True, base_images_needed=base_images)

        error_msg = str(exc_info.value)

        # Error should mention fork PR
        assert 'fork' in error_msg.lower()

        # Error should list missing images
        assert 'ghcr.io/groupsky/homy/alpine:3.18' in error_msg
        assert 'ghcr.io/groupsky/homy/nginx:1.25.0' in error_msg

        # Error should NOT list existing images
        assert 'ghcr.io/groupsky/homy/node:18.20.8-alpine' not in error_msg

        # Error should direct to maintainer
        assert 'maintainer' in error_msg.lower() or 'contact' in error_msg.lower()

    @patch('lib.ghcr_client.check_image_exists')
    def test_validate_fork_pr_base_images_handles_empty_list(self, mock_check):
        """Should handle empty base images list gracefully."""
        # Should not raise even for fork with no base images needed
        validate_fork_pr_base_images(is_fork=True, base_images_needed=[])

        mock_check.assert_not_called()


class TestErrorHandling:
    """Test error handling and error classes."""

    def test_ghcr_error_is_exception(self):
        """GHCRError should be an Exception subclass."""
        error = GHCRError("test error")
        assert isinstance(error, Exception)
        assert str(error) == "test error"

    def test_ghcr_rate_limit_error_is_ghcr_error(self):
        """GHCRRateLimitError should be a GHCRError subclass."""
        error = GHCRRateLimitError("rate limit")
        assert isinstance(error, GHCRError)
        assert isinstance(error, Exception)

    @patch('subprocess.run')
    def test_check_image_exists_distinguishes_404_from_503(self, mock_run):
        """Should distinguish 404 (not found) from 503 (rate limit)."""
        # 404 should return False
        mock_run.return_value = MagicMock(
            returncode=1,
            stderr="ERROR: manifest unknown"
        )
        assert check_image_exists('ghcr.io/groupsky/homy/test:tag') is False

        # 503 should raise GHCRRateLimitError
        mock_run.return_value = MagicMock(
            returncode=1,
            stderr="ERROR: 503 Service Unavailable"
        )
        with pytest.raises(GHCRRateLimitError):
            check_image_exists('ghcr.io/groupsky/homy/test:tag', retries=1)


class TestRetryLogic:
    """Test retry logic and exponential backoff."""

    @patch('subprocess.run')
    @patch('time.sleep')
    def test_exponential_backoff_timing(self, mock_sleep, mock_run):
        """Should use exponential backoff: 1s, 2s, 4s."""
        mock_run.side_effect = [
            MagicMock(returncode=1, stderr="ERROR: timeout"),
            MagicMock(returncode=1, stderr="ERROR: timeout"),
            MagicMock(returncode=1, stderr="ERROR: timeout"),
            MagicMock(returncode=1, stderr="ERROR: timeout"),
        ]

        with pytest.raises(GHCRError):
            check_image_exists('ghcr.io/groupsky/homy/test:tag', retries=4)

        # Should sleep 3 times (between 4 attempts)
        assert mock_sleep.call_count == 3
        sleep_calls = [call[0][0] for call in mock_sleep.call_args_list]
        assert sleep_calls == [1, 2, 4]

    @patch('subprocess.run')
    @patch('time.sleep')
    def test_no_retry_on_manifest_unknown(self, mock_sleep, mock_run):
        """Should not retry on manifest unknown (404) errors."""
        mock_run.return_value = MagicMock(
            returncode=1,
            stderr="ERROR: manifest unknown"
        )

        result = check_image_exists('ghcr.io/groupsky/homy/test:tag', retries=3)

        assert result is False
        mock_run.assert_called_once()  # No retries
        mock_sleep.assert_not_called()

    @patch('subprocess.run')
    @patch('time.sleep')
    def test_retry_on_network_errors(self, mock_sleep, mock_run):
        """Should retry on network/timeout errors."""
        transient_errors = [
            "ERROR: connection timeout",
            "ERROR: connection refused",
            "ERROR: temporary failure",
            "ERROR: i/o timeout",
        ]

        for error_msg in transient_errors:
            mock_run.reset_mock()
            mock_sleep.reset_mock()

            mock_run.side_effect = [
                MagicMock(returncode=1, stderr=error_msg),
                MagicMock(returncode=0, stdout="Name: test"),
            ]

            result = check_image_exists('ghcr.io/groupsky/homy/test:tag', retries=3)

            assert result is True, f"Should retry and succeed for: {error_msg}"
            assert mock_run.call_count == 2, f"Should have retried for: {error_msg}"


class TestIntegration:
    """Integration tests combining multiple functions."""

    @patch('lib.ghcr_client.check_image_exists')
    def test_full_workflow_fork_pr_with_missing_base_images(self, mock_check):
        """Test full workflow: fork PR missing some base images."""
        base_images = [
            'ghcr.io/groupsky/homy/node:18.20.8-alpine',
            'ghcr.io/groupsky/homy/alpine:3.18'
        ]

        services = [
            {
                'service_name': 'automations',
                'image': 'ghcr.io/groupsky/homy/automations:latest',
                'dockerfile_path': 'docker/automations/Dockerfile'
            }
        ]

        # node exists, alpine doesn't
        mock_check.side_effect = [True, False]

        # Fork PR validation should fail
        with pytest.raises(GHCRError, match="fork"):
            validate_fork_pr_base_images(is_fork=True, base_images_needed=base_images)

    @patch('lib.ghcr_client.check_image_exists')
    def test_full_workflow_successful_check(self, mock_check):
        """Test full workflow: all checks pass."""
        base_images = [
            'ghcr.io/groupsky/homy/node:18.20.8-alpine'
        ]

        services = [
            {
                'service_name': 'automations',
                'image': 'ghcr.io/groupsky/homy/automations:latest',
                'dockerfile_path': 'docker/automations/Dockerfile'
            },
            {
                'service_name': 'broker',
                'image': 'ghcr.io/groupsky/homy/mosquitto:latest',
                'dockerfile_path': 'docker/mosquitto/Dockerfile'
            }
        ]

        # Base image exists, automations:sha exists, broker:sha doesn't
        mock_check.side_effect = [True, True, False]

        # Validate fork PR (base image exists)
        validate_fork_pr_base_images(is_fork=True, base_images_needed=base_images)

        # Check services (automations can be retagged, broker needs building)
        to_build, to_retag = check_all_services(services, base_sha='abc123')

        assert len(to_build) == 1
        assert to_build[0]['service_name'] == 'broker'
        assert len(to_retag) == 1
        assert to_retag[0]['service_name'] == 'automations'
