"""
Output formatting for GitHub Actions.

Formats detection results as:
- GitHub Actions outputs (key=value format)
- JSON-encoded arrays for matrix builds
"""

import json
from typing import Dict, List


REQUIRED_OUTPUT_KEYS = [
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


def generate_outputs(detection_result: Dict[str, List[str]]) -> Dict[str, str]:
    """
    Generate GitHub Actions outputs from detection results.

    Converts all array values to JSON strings for GitHub Actions consumption.
    Empty arrays are converted to "[]" string.

    Args:
        detection_result: Dictionary containing detection results with list values

    Returns:
        Dictionary of output key-value pairs (JSON-encoded strings)

    Example:
        >>> result = {
        ...     "base_images": ["node", "alpine"],
        ...     "changed_base_images": ["node"],
        ...     "base_images_needed": [],
        ...     "changed_services": ["automations"],
        ...     "affected_services": [],
        ...     "to_build": [],
        ...     "to_retag": [],
        ...     "testable_services": ["automations"],
        ...     "healthcheck_services": [],
        ...     "version_check_services": []
        ... }
        >>> outputs = generate_outputs(result)
        >>> outputs["base_images"]
        '["node", "alpine"]'
        >>> outputs["to_build"]
        '[]'
    """
    outputs = {}

    for key in REQUIRED_OUTPUT_KEYS:
        value = detection_result.get(key, [])
        outputs[key] = json.dumps(value)

    return outputs


def write_github_output(outputs: Dict[str, str], output_file: str) -> None:
    """
    Write outputs to GitHub Actions output file.

    Outputs are written in the format: key=value (one per line)

    Args:
        outputs: Dictionary of output key-value pairs
        output_file: Path to output file

    Example:
        >>> outputs = {
        ...     "base_images": '["node", "alpine"]',
        ...     "changed_base_images": '["node"]'
        ... }
        >>> write_github_output(outputs, "/tmp/output.txt")
    """
    with open(output_file, "w") as f:
        for key, value in outputs.items():
            f.write(f"{key}={value}\n")


def validate_outputs(outputs: Dict[str, str]) -> None:
    """
    Validate that all required output keys are present.

    Args:
        outputs: Dictionary of output key-value pairs

    Raises:
        ValueError: If any required key is missing

    Example:
        >>> outputs = {"base_images": "[]", "changed_base_images": "[]"}
        >>> validate_outputs(outputs)
        Traceback (most recent call last):
            ...
        ValueError: Missing required output keys: base_images_needed, ...
    """
    missing_keys = [key for key in REQUIRED_OUTPUT_KEYS if key not in outputs]

    if missing_keys:
        raise ValueError(f"Missing required output keys: {', '.join(missing_keys)}")
