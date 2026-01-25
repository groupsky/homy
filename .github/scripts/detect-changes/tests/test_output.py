"""
Tests for output.py module.

Tests:
- GitHub Actions output formatting
- Generation of all required output arrays
- GITHUB_OUTPUT file format validation
- Empty array handling
- Output validation
"""

import json
import tempfile
from pathlib import Path

import pytest


class TestGenerateOutputs:
    """Test generation of all required output arrays."""

    def test_generate_all_required_outputs(self):
        """Should generate all required output keys."""
        from lib.output import generate_outputs

        detection_result = {
            "base_images": ["node", "alpine"],
            "changed_base_images": ["node"],
            "base_images_needed": ["node", "grafana"],
            "changed_services": ["automations"],
            "affected_services": ["mqtt-influx"],
            "to_build": ["ha-discovery"],
            "to_retag": ["modbus-serial"],
            "testable_services": ["automations"],
            "healthcheck_services": ["mqtt-influx"],
            "version_check_services": ["automations", "mqtt-influx"],
        }

        outputs = generate_outputs(detection_result)

        # Verify all required keys exist
        required_keys = [
            "base_images",
            "changed_base_images",
            "base_images_needed",
            "changed_services",
            "affected_services",
            "to_build",
            "to_retag",
            "testable_services",
            "healthcheck_services",
            "version_check_services",
        ]

        for key in required_keys:
            assert key in outputs, f"Missing required output key: {key}"

    def test_generate_outputs_with_non_empty_arrays(self):
        """Should format non-empty arrays as valid JSON."""
        from lib.output import generate_outputs

        detection_result = {
            "base_images": ["node", "alpine"],
            "changed_base_images": ["node"],
            "base_images_needed": [],
            "changed_services": ["automations", "mqtt-influx"],
            "affected_services": [],
            "to_build": [],
            "to_retag": [],
            "testable_services": ["automations"],
            "healthcheck_services": [],
            "version_check_services": ["automations"],
        }

        outputs = generate_outputs(detection_result)

        # Verify JSON is valid
        base_images = json.loads(outputs["base_images"])
        assert base_images == ["node", "alpine"]

        changed_base = json.loads(outputs["changed_base_images"])
        assert changed_base == ["node"]

        changed_services = json.loads(outputs["changed_services"])
        assert changed_services == ["automations", "mqtt-influx"]

        testable = json.loads(outputs["testable_services"])
        assert testable == ["automations"]

    def test_generate_outputs_with_empty_arrays(self):
        """Should handle empty arrays and output '[]'."""
        from lib.output import generate_outputs

        detection_result = {
            "base_images": [],
            "changed_base_images": [],
            "base_images_needed": [],
            "changed_services": [],
            "affected_services": [],
            "to_build": [],
            "to_retag": [],
            "testable_services": [],
            "healthcheck_services": [],
            "version_check_services": [],
        }

        outputs = generate_outputs(detection_result)

        # All outputs should be empty JSON arrays
        for key in outputs:
            assert outputs[key] == "[]", f"{key} should be '[]' for empty array"
            # Verify it's valid JSON
            parsed = json.loads(outputs[key])
            assert parsed == []

    def test_generate_outputs_preserves_order(self):
        """Should preserve array element order."""
        from lib.output import generate_outputs

        detection_result = {
            "base_images": ["zebra", "alpha", "beta"],
            "changed_base_images": [],
            "base_images_needed": [],
            "changed_services": ["service-z", "service-a"],
            "affected_services": [],
            "to_build": [],
            "to_retag": [],
            "testable_services": [],
            "healthcheck_services": [],
            "version_check_services": [],
        }

        outputs = generate_outputs(detection_result)

        base_images = json.loads(outputs["base_images"])
        assert base_images == ["zebra", "alpha", "beta"]

        changed_services = json.loads(outputs["changed_services"])
        assert changed_services == ["service-z", "service-a"]

    def test_generate_outputs_handles_special_characters(self):
        """Should handle service names with hyphens and underscores."""
        from lib.output import generate_outputs

        detection_result = {
            "base_images": ["node-18.20.8-alpine", "alpine_3.19"],
            "changed_base_images": [],
            "base_images_needed": [],
            "changed_services": ["mqtt-influx", "ha_discovery"],
            "affected_services": [],
            "to_build": [],
            "to_retag": [],
            "testable_services": [],
            "healthcheck_services": [],
            "version_check_services": [],
        }

        outputs = generate_outputs(detection_result)

        base_images = json.loads(outputs["base_images"])
        assert "node-18.20.8-alpine" in base_images
        assert "alpine_3.19" in base_images

        changed_services = json.loads(outputs["changed_services"])
        assert "mqtt-influx" in changed_services
        assert "ha_discovery" in changed_services


class TestWriteGithubOutput:
    """Test writing outputs to GITHUB_OUTPUT file."""

    def test_write_github_output_format(self):
        """Should write outputs in correct GITHUB_OUTPUT format."""
        from lib.output import write_github_output

        outputs = {
            "base_images": '["node", "alpine"]',
            "changed_base_images": '["node"]',
            "to_build": "[]",
        }

        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".txt") as f:
            output_file = f.name

        try:
            write_github_output(outputs, output_file)

            # Read and verify format
            content = Path(output_file).read_text()
            lines = content.strip().split("\n")

            # Should have one line per output
            assert len(lines) == 3

            # Each line should be key=value format
            for line in lines:
                assert "=" in line
                key, value = line.split("=", 1)
                assert key in outputs
                assert value == outputs[key]

        finally:
            Path(output_file).unlink()

    def test_write_github_output_handles_empty_arrays(self):
        """Should handle empty arrays correctly."""
        from lib.output import write_github_output

        outputs = {
            "base_images": "[]",
            "changed_base_images": "[]",
            "to_build": "[]",
        }

        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".txt") as f:
            output_file = f.name

        try:
            write_github_output(outputs, output_file)

            content = Path(output_file).read_text()
            lines = content.strip().split("\n")

            # All lines should have [] as value
            for line in lines:
                _, value = line.split("=", 1)
                assert value == "[]"

        finally:
            Path(output_file).unlink()

    def test_write_github_output_handles_complex_json(self):
        """Should handle JSON arrays with multiple elements."""
        from lib.output import write_github_output

        outputs = {
            "changed_services": '["automations", "mqtt-influx", "ha-discovery"]',
            "testable_services": '["automations"]',
        }

        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".txt") as f:
            output_file = f.name

        try:
            write_github_output(outputs, output_file)

            content = Path(output_file).read_text()

            # Verify content can be parsed
            for line in content.strip().split("\n"):
                key, value = line.split("=", 1)
                assert key in outputs
                # Verify JSON is valid
                parsed = json.loads(value)
                assert isinstance(parsed, list)

        finally:
            Path(output_file).unlink()

    def test_write_github_output_creates_file_if_not_exists(self):
        """Should create output file if it doesn't exist."""
        from lib.output import write_github_output

        outputs = {"base_images": "[]"}

        with tempfile.TemporaryDirectory() as tmpdir:
            output_file = Path(tmpdir) / "github_output.txt"

            write_github_output(outputs, str(output_file))

            assert output_file.exists()
            content = output_file.read_text()
            assert "base_images=[]" in content

    def test_write_github_output_overwrites_existing_file(self):
        """Should overwrite existing output file."""
        from lib.output import write_github_output

        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".txt") as f:
            output_file = f.name
            f.write("existing content\n")

        try:
            outputs = {"base_images": "[]"}
            write_github_output(outputs, output_file)

            content = Path(output_file).read_text()
            assert "existing content" not in content
            assert "base_images=[]" in content

        finally:
            Path(output_file).unlink()


class TestValidateOutputs:
    """Test output validation."""

    def test_validate_all_required_keys_present(self):
        """Should pass when all required keys are present."""
        from lib.output import validate_outputs

        outputs = {
            "base_images": "[]",
            "changed_base_images": "[]",
            "base_images_needed": "[]",
            "changed_services": "[]",
            "affected_services": "[]",
            "to_build": "[]",
            "to_retag": "[]",
            "testable_services": "[]",
            "healthcheck_services": "[]",
            "version_check_services": "[]",
        }

        # Should not raise exception
        validate_outputs(outputs)

    def test_validate_missing_required_key(self):
        """Should raise error when required key is missing."""
        from lib.output import validate_outputs

        outputs = {
            "base_images": "[]",
            "changed_base_images": "[]",
            # Missing other required keys
        }

        with pytest.raises(ValueError) as exc_info:
            validate_outputs(outputs)

        error_msg = str(exc_info.value)
        assert "missing" in error_msg.lower() or "required" in error_msg.lower()

    def test_validate_empty_outputs_dict(self):
        """Should raise error when outputs dict is empty."""
        from lib.output import validate_outputs

        outputs = {}

        with pytest.raises(ValueError):
            validate_outputs(outputs)

    def test_validate_extra_keys_allowed(self):
        """Should allow extra keys beyond required ones."""
        from lib.output import validate_outputs

        outputs = {
            "base_images": "[]",
            "changed_base_images": "[]",
            "base_images_needed": "[]",
            "changed_services": "[]",
            "affected_services": "[]",
            "to_build": "[]",
            "to_retag": "[]",
            "testable_services": "[]",
            "healthcheck_services": "[]",
            "version_check_services": "[]",
            "extra_key": "some_value",  # Extra key
        }

        # Should not raise exception
        validate_outputs(outputs)


class TestOutputIntegration:
    """Test complete output generation workflow."""

    def test_generate_and_write_workflow(self):
        """Test complete workflow: generate -> validate -> write."""
        from lib.output import generate_outputs, validate_outputs, write_github_output

        detection_result = {
            "base_images": ["node", "alpine"],
            "changed_base_images": ["node"],
            "base_images_needed": ["grafana"],
            "changed_services": ["automations"],
            "affected_services": ["mqtt-influx"],
            "to_build": ["ha-discovery"],
            "to_retag": ["modbus-serial"],
            "testable_services": ["automations"],
            "healthcheck_services": ["mqtt-influx"],
            "version_check_services": ["automations"],
        }

        # Generate outputs
        outputs = generate_outputs(detection_result)

        # Validate outputs
        validate_outputs(outputs)

        # Write to file
        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".txt") as f:
            output_file = f.name

        try:
            write_github_output(outputs, output_file)

            # Verify file contents
            content = Path(output_file).read_text()
            assert "base_images=" in content
            assert "changed_base_images=" in content
            assert "testable_services=" in content

            # Verify all arrays are valid JSON
            for line in content.strip().split("\n"):
                _, value = line.split("=", 1)
                json.loads(value)  # Should not raise

        finally:
            Path(output_file).unlink()

    def test_all_empty_arrays_workflow(self):
        """Test workflow when all arrays are empty."""
        from lib.output import generate_outputs, validate_outputs, write_github_output

        detection_result = {
            "base_images": [],
            "changed_base_images": [],
            "base_images_needed": [],
            "changed_services": [],
            "affected_services": [],
            "to_build": [],
            "to_retag": [],
            "testable_services": [],
            "healthcheck_services": [],
            "version_check_services": [],
        }

        outputs = generate_outputs(detection_result)
        validate_outputs(outputs)

        with tempfile.NamedTemporaryFile(mode="w+", delete=False, suffix=".txt") as f:
            output_file = f.name

        try:
            write_github_output(outputs, output_file)

            content = Path(output_file).read_text()
            lines = content.strip().split("\n")

            # All lines should have [] value
            for line in lines:
                _, value = line.split("=", 1)
                assert value == "[]"

        finally:
            Path(output_file).unlink()
