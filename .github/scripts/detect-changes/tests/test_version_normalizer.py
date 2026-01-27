"""
Test suite for version_normalizer module.

Following TDD principles, these tests define expected behavior
for version normalization functionality before implementation.

All tests should FAIL initially (red phase).
"""

import pytest
from version_normalizer import normalize_version, extract_semver_core


class TestNormalizeAlpineVersions:
    """Test normalization of Alpine Linux version suffixes."""

    def test_alpine_3_21_suffix(self):
        """Should normalize alpine3.21 to alpine."""
        assert normalize_version("18.20.8-alpine3.21") == "18.20.8-alpine"

    def test_alpine_3_19_suffix(self):
        """Should normalize alpine3.19 to alpine."""
        assert normalize_version("1.6.23-alpine3.19") == "1.6.23-alpine"

    def test_alpine_3_18_suffix(self):
        """Should normalize alpine3.18 to alpine."""
        assert normalize_version("16.14.2-alpine3.18") == "16.14.2-alpine"

    def test_alpine_3_20_suffix(self):
        """Should normalize alpine3.20 to alpine."""
        assert normalize_version("20.11.1-alpine3.20") == "20.11.1-alpine"

    def test_alpine_generic_suffix(self):
        """Should preserve generic alpine suffix without version."""
        assert normalize_version("22.0.0-alpine") == "22.0.0-alpine"

    def test_alpine_edge_version(self):
        """Should normalize alpine edge versions."""
        assert normalize_version("3.21.0-alpine3.21") == "3.21.0-alpine"

    def test_multiple_digit_alpine_version(self):
        """Should handle alpine versions with multiple digits."""
        assert normalize_version("1.2.3-alpine3.100") == "1.2.3-alpine"


class TestNormalizeDebianVersions:
    """Test normalization of Debian version suffixes."""

    def test_debian_12_suffix(self):
        """Should normalize debian12 to debian."""
        assert normalize_version("11.2-debian12") == "11.2-debian"

    def test_debian_11_suffix(self):
        """Should normalize debian11 to debian."""
        assert normalize_version("10.5.1-debian11") == "10.5.1-debian"

    def test_debian_10_suffix(self):
        """Should normalize debian10 to debian."""
        assert normalize_version("9.0.0-debian10") == "9.0.0-debian"

    def test_debian_generic_suffix(self):
        """Should preserve generic debian suffix without version."""
        assert normalize_version("8.1.0-debian") == "8.1.0-debian"

    def test_debian_bookworm_named(self):
        """Should handle debian bookworm named releases."""
        # Some images use named releases instead of numbers
        assert normalize_version("12.0-bookworm") == "12.0-bookworm"


class TestNormalizeUbuntuVersions:
    """Test normalization of Ubuntu version suffixes."""

    def test_ubuntu_22_04_suffix(self):
        """Should normalize ubuntu22.04 to ubuntu."""
        assert normalize_version("20.04-ubuntu22.04") == "20.04-ubuntu"

    def test_ubuntu_20_04_suffix(self):
        """Should normalize ubuntu20.04 to ubuntu."""
        assert normalize_version("18.04-ubuntu20.04") == "18.04-ubuntu"

    def test_ubuntu_24_04_suffix(self):
        """Should normalize ubuntu24.04 to ubuntu."""
        assert normalize_version("22.04-ubuntu24.04") == "22.04-ubuntu"

    def test_ubuntu_generic_suffix(self):
        """Should preserve generic ubuntu suffix without version."""
        assert normalize_version("20.04-ubuntu") == "20.04-ubuntu"

    def test_ubuntu_lts_suffix(self):
        """Should handle ubuntu LTS versions."""
        assert normalize_version("20.04-ubuntu22.04-lts") == "20.04-ubuntu-lts"


class TestPreserveNonPlatformSuffixes:
    """Test that non-platform suffixes are preserved."""

    def test_openssl_suffix(self):
        """Should preserve openssl suffix."""
        assert normalize_version("1.6.23-openssl") == "1.6.23-openssl"

    def test_slim_suffix(self):
        """Should preserve slim suffix."""
        assert normalize_version("18.20.8-slim") == "18.20.8-slim"

    def test_bullseye_suffix(self):
        """Should preserve Debian codename suffixes."""
        assert normalize_version("16.14.2-bullseye") == "16.14.2-bullseye"

    def test_bookworm_suffix(self):
        """Should preserve bookworm suffix."""
        assert normalize_version("20.10.0-bookworm") == "20.10.0-bookworm"

    def test_no_suffix(self):
        """Should preserve versions without suffixes."""
        assert normalize_version("9.5.21") == "9.5.21"

    def test_custom_build_suffix(self):
        """Should preserve custom build suffixes."""
        assert normalize_version("1.0.0-custom-build") == "1.0.0-custom-build"

    def test_sha_suffix(self):
        """Should preserve SHA-based suffixes."""
        assert normalize_version("v1.2.3-abc123") == "v1.2.3-abc123"


class TestExtractSemverCore:
    """Test extraction of semantic version core."""

    def test_extract_from_alpine_version(self):
        """Should extract core version from alpine image."""
        assert extract_semver_core("18.20.8-alpine") == "18.20.8"

    def test_extract_from_debian_version(self):
        """Should extract core version from debian image."""
        assert extract_semver_core("11.2-debian") == "11.2"

    def test_extract_from_ubuntu_version(self):
        """Should extract core version from ubuntu image."""
        assert extract_semver_core("20.04-ubuntu") == "20.04"

    def test_extract_from_plain_version(self):
        """Should extract core version from plain semver."""
        assert extract_semver_core("9.5.21") == "9.5.21"

    def test_extract_from_complex_suffix(self):
        """Should extract core version from complex suffixes."""
        assert extract_semver_core("1.6.23-openssl-alpine") == "1.6.23"

    def test_extract_with_v_prefix(self):
        """Should handle versions with v prefix."""
        assert extract_semver_core("v1.2.3") == "1.2.3"

    def test_extract_two_part_version(self):
        """Should handle two-part versions."""
        assert extract_semver_core("22.0") == "22.0"

    def test_extract_four_part_version(self):
        """Should handle four-part versions."""
        assert extract_semver_core("1.2.3.4-alpine") == "1.2.3.4"

    def test_extract_from_normalized_alpine(self):
        """Should extract from already normalized alpine versions."""
        assert extract_semver_core("18.20.8-alpine") == "18.20.8"


class TestComplexVersionNormalization:
    """Test complex version normalization scenarios."""

    def test_multiple_platform_suffixes(self):
        """Should normalize when multiple platform indicators exist."""
        # Some images might have complex suffix chains
        assert normalize_version("1.2.3-alpine3.19-slim") == "1.2.3-alpine-slim"

    def test_debian_with_codename(self):
        """Should normalize debian version but preserve codename."""
        assert normalize_version("11.0-debian12-bookworm") == "11.0-debian-bookworm"

    def test_alpine_with_additional_tags(self):
        """Should normalize alpine but preserve additional tags."""
        assert normalize_version("16.14.2-alpine3.18-openssl") == "16.14.2-alpine-openssl"

    def test_version_with_build_metadata(self):
        """Should handle versions with build metadata."""
        assert normalize_version("1.0.0+build123-alpine3.19") == "1.0.0+build123-alpine"

    def test_version_with_prerelease(self):
        """Should handle prerelease versions."""
        assert normalize_version("2.0.0-rc1-alpine3.20") == "2.0.0-rc1-alpine"

    def test_version_with_prerelease_and_build(self):
        """Should handle prerelease with build metadata."""
        assert normalize_version("3.0.0-beta.1+exp.sha.abc-alpine3.21") == "3.0.0-beta.1+exp.sha.abc-alpine"


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_empty_string(self):
        """Should handle empty string."""
        assert normalize_version("") == ""

    def test_only_suffix(self):
        """Should handle version that is only a suffix."""
        assert normalize_version("alpine3.19") == "alpine"

    def test_malformed_version(self):
        """Should handle malformed versions gracefully."""
        # Don't crash on unexpected input
        result = normalize_version("not-a-version-123-alpine3.19")
        assert isinstance(result, str)

    def test_very_long_version(self):
        """Should handle very long version strings."""
        long_version = "1.2.3.4.5.6.7.8-alpine3.19-extra-long-suffix-chain"
        result = normalize_version(long_version)
        assert "alpine3.19" not in result
        assert "alpine" in result

    def test_version_with_underscores(self):
        """Should handle versions with underscores."""
        assert normalize_version("1_2_3-alpine3.19") == "1_2_3-alpine"

    def test_none_input(self):
        """Should handle None input gracefully."""
        with pytest.raises(TypeError):
            normalize_version(None)

    def test_numeric_input(self):
        """Should handle numeric input."""
        with pytest.raises(AttributeError):
            normalize_version(123)


class TestRealWorldExamples:
    """Test with real-world Docker image version strings."""

    def test_node_official_image(self):
        """Should normalize Node.js official image versions."""
        assert normalize_version("18.20.8-alpine3.21") == "18.20.8-alpine"
        assert normalize_version("22.0.0-alpine3.20") == "22.0.0-alpine"

    def test_nginx_official_image(self):
        """Should normalize nginx official image versions."""
        assert normalize_version("1.27.3-alpine3.20") == "1.27.3-alpine"
        assert normalize_version("1.26.2-alpine3.19-slim") == "1.26.2-alpine-slim"

    def test_postgres_official_image(self):
        """Should normalize PostgreSQL official image versions."""
        assert normalize_version("16.1-alpine3.19") == "16.1-alpine"
        assert normalize_version("15.5-debian12") == "15.5-debian"

    def test_python_official_image(self):
        """Should normalize Python official image versions."""
        assert normalize_version("3.12.1-alpine3.19") == "3.12.1-alpine"
        assert normalize_version("3.11.7-slim-debian12") == "3.11.7-slim-debian"

    def test_redis_official_image(self):
        """Should normalize Redis official image versions."""
        assert normalize_version("7.2.4-alpine3.19") == "7.2.4-alpine"

    def test_grafana_image(self):
        """Should handle Grafana-specific versioning."""
        assert normalize_version("9.5.21") == "9.5.21"
        assert normalize_version("10.0.0-ubuntu22.04") == "10.0.0-ubuntu"

    def test_influxdb_image(self):
        """Should handle InfluxDB versioning."""
        assert normalize_version("2.7.4-alpine3.19") == "2.7.4-alpine"

    def test_mosquitto_image(self):
        """Should handle Mosquitto MQTT broker versioning."""
        assert normalize_version("2.0.18-openssl") == "2.0.18-openssl"


class TestNormalizationIdempotency:
    """Test that normalization is idempotent."""

    def test_normalize_twice_alpine(self):
        """Normalizing twice should give same result."""
        first = normalize_version("18.20.8-alpine3.21")
        second = normalize_version(first)
        assert first == second == "18.20.8-alpine"

    def test_normalize_twice_debian(self):
        """Normalizing twice should give same result."""
        first = normalize_version("11.2-debian12")
        second = normalize_version(first)
        assert first == second == "11.2-debian"

    def test_normalize_already_normalized(self):
        """Already normalized versions should remain unchanged."""
        assert normalize_version("1.2.3-alpine") == "1.2.3-alpine"
        assert normalize_version("4.5.6-debian") == "4.5.6-debian"
        assert normalize_version("7.8.9") == "7.8.9"
