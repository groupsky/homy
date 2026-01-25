"""
Configuration validation utilities.

Validates:
- package.json structure and test scripts
- .nvmrc format and Node.js version specifications
- Dockerfile syntax and best practices (reusing dockerfile_parser)
"""

import json
import re
from pathlib import Path
from typing import Optional

from dockerfile_parser import ValidationError, validate_no_arg_in_from, parse_from_lines


def validate_package_json(package_json_path: str) -> bool:
    """
    Parse and validate package.json file for real test scripts.

    Args:
        package_json_path: Path to package.json file

    Returns:
        True if package.json has real test scripts, False if placeholder or missing

    Raises:
        ValidationError: If file doesn't exist or contains invalid JSON

    Example:
        >>> validate_package_json("docker/my-service/package.json")
        True
    """
    path = Path(package_json_path)

    if not path.exists():
        raise ValidationError(f"package.json not found: {package_json_path}")

    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise ValidationError(f"Invalid JSON in {package_json_path}: {e}")

    # Check for scripts.test
    scripts = data.get('scripts', {})
    test_script = scripts.get('test', '')

    if not test_script:
        return False

    return has_real_tests(test_script)


def validate_nvmrc(nvmrc_path: str) -> bool:
    """
    Validate .nvmrc file format and version specification.

    Args:
        nvmrc_path: Path to .nvmrc file

    Returns:
        True if .nvmrc contains valid semantic version

    Raises:
        ValidationError: If file doesn't exist, is empty, or contains invalid format

    Example:
        >>> validate_nvmrc("docker/my-service/.nvmrc")
        True
    """
    path = Path(nvmrc_path)

    if not path.exists():
        raise ValidationError(f".nvmrc not found: {nvmrc_path}")

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read().strip()

    if not content:
        raise ValidationError(f".nvmrc is empty: {nvmrc_path}")

    # Remove 'v' prefix if present
    version = content.lstrip('v')

    # Check for lts/* format
    if version.lower().startswith('lts/'):
        raise ValidationError(
            f".nvmrc contains lts/* format which is not allowed: {nvmrc_path}. "
            "Use specific semantic version instead (e.g., 18.20.8)"
        )

    # Validate semantic version format
    # Accept X.Y.Z or X.Y
    semver_pattern = r'^\d+\.\d+(\.\d+)?$'
    if not re.match(semver_pattern, version):
        raise ValidationError(
            f".nvmrc contains invalid semver format: {content}. "
            "Expected format: X.Y.Z or X.Y (e.g., 18.20.8)"
        )

    return True


def validate_dockerfile(dockerfile_path: str) -> bool:
    """
    Validate Dockerfile exists and has basic required structure.

    Reuses validation from dockerfile_parser module.

    Args:
        dockerfile_path: Path to Dockerfile

    Returns:
        True if Dockerfile is valid

    Raises:
        ValidationError: If file doesn't exist or fails validation

    Example:
        >>> validate_dockerfile("docker/my-service/Dockerfile")
        True
    """
    path = Path(dockerfile_path)

    if not path.exists():
        raise ValidationError(f"Dockerfile not found: {dockerfile_path}")

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    if not content.strip():
        raise ValidationError(f"Dockerfile is empty: {dockerfile_path}")

    # Check for FROM instruction
    from_lines = parse_from_lines(content)
    if not from_lines:
        raise ValidationError(
            f"Dockerfile missing FROM instruction: {dockerfile_path}"
        )

    # Validate no ARG in FROM
    try:
        validate_no_arg_in_from(content)
    except ValidationError as e:
        # Re-raise with context
        raise ValidationError(f"Dockerfile validation failed for {dockerfile_path}: {e}")

    return True


def has_real_tests(test_script: str) -> bool:
    """
    Detect whether test script is real or a placeholder.

    Args:
        test_script: The test script command from package.json

    Returns:
        True if script appears to run real tests, False for placeholders

    Example:
        >>> has_real_tests("jest")
        True
        >>> has_real_tests("echo \\"Error: no test specified\\" && exit 1")
        False
    """
    if not test_script or not test_script.strip():
        return False

    script = test_script.lower().strip()

    # Placeholder patterns that indicate no real tests
    placeholder_patterns = [
        r'echo.*error.*no.*test',
        r'echo.*no.*test',
        r'^exit\s+1',
        r'echo.*&&.*exit',
    ]

    for pattern in placeholder_patterns:
        if re.search(pattern, script):
            return False

    # Real test runners
    real_test_patterns = [
        r'\bjest\b',
        r'\bmocha\b',
        r'\btap\b',
        r'\bpytest\b',
        r'\bnpm\s+(run\s+)?test\b',
        r'\bnode\s+--test\b',
        r'\bpython\s+-m\s+pytest\b',
    ]

    for pattern in real_test_patterns:
        if re.search(pattern, script):
            return True

    # If we get here, it's unclear - assume it's a real test
    # (could be a custom script like './run-tests.sh')
    return True
