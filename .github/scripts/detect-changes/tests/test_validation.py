"""
Tests for validation.py module.

This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
for the validation module BEFORE implementation. All tests will initially FAIL (red phase)
until the implementation is complete.

The validation module is responsible for:
1. Validating package.json structure and test scripts
2. Validating .nvmrc format and Node.js version specifications
3. Detecting real vs placeholder test scripts
4. Validating Dockerfile existence and basic structure
"""

import pytest
import tempfile
import json
from pathlib import Path


class TestValidatePackageJson:
    """Test package.json parsing and validation."""

    def test_parse_valid_package_json(self):
        """Should successfully parse valid package.json."""
        from validation import validate_package_json

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({
                "name": "test-service",
                "version": "1.0.0",
                "scripts": {
                    "test": "jest"
                }
            }, f)
            f.flush()

            result = validate_package_json(f.name)

            assert result is True
            Path(f.name).unlink()

    def test_detect_real_test_script(self):
        """Should detect real test scripts (not placeholder)."""
        from validation import validate_package_json

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({
                "name": "test-service",
                "version": "1.0.0",
                "scripts": {
                    "test": "jest --coverage"
                }
            }, f)
            f.flush()

            result = validate_package_json(f.name)

            assert result is True
            Path(f.name).unlink()

    def test_return_false_for_placeholder_tests(self):
        """Should return False for placeholder test scripts."""
        from validation import validate_package_json

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({
                "name": "test-service",
                "version": "1.0.0",
                "scripts": {
                    "test": "echo \"Error: no test specified\" && exit 1"
                }
            }, f)
            f.flush()

            result = validate_package_json(f.name)

            assert result is False
            Path(f.name).unlink()

    def test_raise_error_for_invalid_json(self):
        """Should raise ValidationError for invalid JSON."""
        from validation import validate_package_json, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write("{ invalid json")
            f.flush()

            with pytest.raises(ValidationError, match="Invalid JSON"):
                validate_package_json(f.name)

            Path(f.name).unlink()

    def test_handle_missing_file_gracefully(self):
        """Should raise ValidationError for missing file."""
        from validation import validate_package_json, ValidationError

        with pytest.raises(ValidationError, match="not found|does not exist"):
            validate_package_json("/nonexistent/package.json")

    def test_handle_missing_scripts_field(self):
        """Should handle package.json without scripts field."""
        from validation import validate_package_json

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({
                "name": "test-service",
                "version": "1.0.0"
            }, f)
            f.flush()

            result = validate_package_json(f.name)

            assert result is False
            Path(f.name).unlink()

    def test_handle_missing_test_script(self):
        """Should handle scripts field without test property."""
        from validation import validate_package_json

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump({
                "name": "test-service",
                "version": "1.0.0",
                "scripts": {
                    "start": "node index.js"
                }
            }, f)
            f.flush()

            result = validate_package_json(f.name)

            assert result is False
            Path(f.name).unlink()


class TestValidateNvmrcFormat:
    """Test .nvmrc validation."""

    def test_validate_valid_nvmrc(self):
        """Should validate valid .nvmrc with semantic version."""
        from validation import validate_nvmrc

        with tempfile.NamedTemporaryFile(mode='w', suffix='.nvmrc', delete=False) as f:
            f.write("18.20.8\n")
            f.flush()

            result = validate_nvmrc(f.name)

            assert result is True
            Path(f.name).unlink()

    def test_validate_major_minor_version(self):
        """Should validate .nvmrc with major.minor version."""
        from validation import validate_nvmrc

        with tempfile.NamedTemporaryFile(mode='w', suffix='.nvmrc', delete=False) as f:
            f.write("20.20.0\n")
            f.flush()

            result = validate_nvmrc(f.name)

            assert result is True
            Path(f.name).unlink()

    def test_reject_empty_nvmrc(self):
        """Should reject empty .nvmrc file."""
        from validation import validate_nvmrc, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='.nvmrc', delete=False) as f:
            f.write("")
            f.flush()

            with pytest.raises(ValidationError, match="empty|invalid"):
                validate_nvmrc(f.name)

            Path(f.name).unlink()

    def test_reject_lts_format(self):
        """Should reject lts/* format in .nvmrc."""
        from validation import validate_nvmrc, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='.nvmrc', delete=False) as f:
            f.write("lts/hydrogen\n")
            f.flush()

            with pytest.raises(ValidationError, match="lts|not allowed"):
                validate_nvmrc(f.name)

            Path(f.name).unlink()

    def test_reject_invalid_semver(self):
        """Should reject invalid semantic version."""
        from validation import validate_nvmrc, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='.nvmrc', delete=False) as f:
            f.write("not-a-version\n")
            f.flush()

            with pytest.raises(ValidationError, match="invalid|semver"):
                validate_nvmrc(f.name)

            Path(f.name).unlink()

    def test_handle_missing_nvmrc_file(self):
        """Should raise ValidationError for missing .nvmrc file."""
        from validation import validate_nvmrc, ValidationError

        with pytest.raises(ValidationError, match="not found|does not exist"):
            validate_nvmrc("/nonexistent/.nvmrc")

    def test_accept_version_with_v_prefix(self):
        """Should accept version with 'v' prefix."""
        from validation import validate_nvmrc

        with tempfile.NamedTemporaryFile(mode='w', suffix='.nvmrc', delete=False) as f:
            f.write("v18.20.8\n")
            f.flush()

            result = validate_nvmrc(f.name)

            assert result is True
            Path(f.name).unlink()


class TestValidateDockerfile:
    """Test Dockerfile validation."""

    def test_validate_dockerfile_exists(self):
        """Should validate that Dockerfile exists."""
        from validation import validate_dockerfile

        with tempfile.NamedTemporaryFile(mode='w', suffix='Dockerfile', delete=False) as f:
            f.write("FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n")
            f.flush()

            result = validate_dockerfile(f.name)

            assert result is True
            Path(f.name).unlink()

    def test_raise_error_for_missing_dockerfile(self):
        """Should raise ValidationError for missing Dockerfile."""
        from validation import validate_dockerfile, ValidationError

        with pytest.raises(ValidationError, match="not found|does not exist"):
            validate_dockerfile("/nonexistent/Dockerfile")

    def test_validate_dockerfile_with_from_instruction(self):
        """Should validate Dockerfile has FROM instruction."""
        from validation import validate_dockerfile

        with tempfile.NamedTemporaryFile(mode='w', suffix='Dockerfile', delete=False) as f:
            f.write("""
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /app
COPY . .
CMD ["node", "index.js"]
""")
            f.flush()

            result = validate_dockerfile(f.name)

            assert result is True
            Path(f.name).unlink()

    def test_reject_dockerfile_without_from(self):
        """Should reject Dockerfile without FROM instruction."""
        from validation import validate_dockerfile, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='Dockerfile', delete=False) as f:
            f.write("WORKDIR /app\nCOPY . .\n")
            f.flush()

            with pytest.raises(ValidationError, match="FROM|missing"):
                validate_dockerfile(f.name)

            Path(f.name).unlink()

    def test_reject_dockerfile_with_arg_in_from(self):
        """Should reject Dockerfile with ARG in FROM."""
        from validation import validate_dockerfile, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='Dockerfile', delete=False) as f:
            f.write("""
ARG NODE_VERSION=18
FROM node:${NODE_VERSION}
""")
            f.flush()

            with pytest.raises(ValidationError, match="ARG|variable"):
                validate_dockerfile(f.name)

            Path(f.name).unlink()

    def test_validate_empty_dockerfile(self):
        """Should reject empty Dockerfile."""
        from validation import validate_dockerfile, ValidationError

        with tempfile.NamedTemporaryFile(mode='w', suffix='Dockerfile', delete=False) as f:
            f.write("")
            f.flush()

            with pytest.raises(ValidationError, match="empty|FROM"):
                validate_dockerfile(f.name)

            Path(f.name).unlink()


class TestHasRealTests:
    """Test detection of real vs placeholder test scripts."""

    def test_true_for_jest(self):
        """Should return True for jest test runner."""
        from validation import has_real_tests

        assert has_real_tests("jest") is True
        assert has_real_tests("jest --coverage") is True
        assert has_real_tests("NODE_ENV=test jest") is True

    def test_true_for_mocha(self):
        """Should return True for mocha test runner."""
        from validation import has_real_tests

        assert has_real_tests("mocha") is True
        assert has_real_tests("mocha tests/**/*.test.js") is True

    def test_true_for_npm_run_test(self):
        """Should return True for npm run test."""
        from validation import has_real_tests

        assert has_real_tests("npm run test") is True
        assert has_real_tests("npm test") is True

    def test_true_for_node_test(self):
        """Should return True for node test command."""
        from validation import has_real_tests

        assert has_real_tests("node --test") is True
        assert has_real_tests("node --test tests/") is True

    def test_false_for_echo_error(self):
        """Should return False for 'echo Error: no test specified'."""
        from validation import has_real_tests

        assert has_real_tests("echo \"Error: no test specified\"") is False
        assert has_real_tests('echo "Error: no test specified"') is False

    def test_false_for_exit_1(self):
        """Should return False for 'exit 1'."""
        from validation import has_real_tests

        assert has_real_tests("exit 1") is False
        assert has_real_tests("echo \"Error: no test specified\" && exit 1") is False

    def test_false_for_empty_string(self):
        """Should return False for empty string."""
        from validation import has_real_tests

        assert has_real_tests("") is False
        assert has_real_tests("   ") is False

    def test_false_for_placeholder_variations(self):
        """Should return False for various placeholder patterns."""
        from validation import has_real_tests

        assert has_real_tests("echo 'no tests'") is False
        assert has_real_tests("echo no test && exit 1") is False

    def test_true_for_pytest(self):
        """Should return True for pytest test runner."""
        from validation import has_real_tests

        assert has_real_tests("pytest") is True
        assert has_real_tests("python -m pytest") is True

    def test_true_for_tap(self):
        """Should return True for TAP test runner."""
        from validation import has_real_tests

        assert has_real_tests("tap") is True
        assert has_real_tests("node --test | tap") is True
