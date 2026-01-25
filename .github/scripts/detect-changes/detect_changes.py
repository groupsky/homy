#!/usr/bin/env python3
"""
Main entry point for Docker build change detection.

This script analyzes file changes and determines which Docker images
need to be rebuilt, outputting a build matrix for GitHub Actions.
"""

import argparse
import sys
import logging
from pathlib import Path

# Add lib directory to Python path
sys.path.insert(0, str(Path(__file__).parent / 'lib'))

from base_images import discover_base_images, build_directory_to_ghcr_mapping
from services import discover_services_from_compose
from change_detection import detect_changed_base_images, detect_changed_services
from dependency_graph import build_reverse_dependency_map, detect_affected_services
from ghcr_client import check_all_services, validate_fork_pr_base_images, GHCRError
from validation import validate_package_json, has_real_tests
from dockerfile_parser import has_healthcheck, extract_final_stage_base
from output import generate_outputs, write_github_output, validate_outputs


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stderr
)
logger = logging.getLogger(__name__)


def parse_args():
    """Parse command-line arguments."""
    parser = argparse.ArgumentParser(
        description='Detect which Docker images need rebuilding based on file changes'
    )

    parser.add_argument(
        '--base-ref',
        required=True,
        help='Git reference to compare against (e.g., origin/master)'
    )

    parser.add_argument(
        '--base-images-dir',
        default='base-images',
        help='Path to base-images directory (default: base-images)'
    )

    parser.add_argument(
        '--compose-file',
        default='docker-compose.yml',
        help='Path to docker-compose.yml (default: docker-compose.yml)'
    )

    parser.add_argument(
        '--env-file',
        default='example.env',
        help='Path to .env file (default: example.env)'
    )

    parser.add_argument(
        '--docker-dir',
        default='docker',
        help='Path to docker directory (default: docker)'
    )

    parser.add_argument(
        '--is-fork',
        action='store_true',
        help='Whether this is a fork PR (default: false)'
    )

    parser.add_argument(
        '--output-file',
        required=True,
        help='Path to output file for GitHub Actions outputs'
    )

    parser.add_argument(
        '--base-sha',
        default='HEAD',
        help='Git SHA to use for image tags (default: HEAD)'
    )

    return parser.parse_args()


def has_nvmrc(build_context: str) -> bool:
    """Check if a service has an .nvmrc file."""
    nvmrc_path = Path(build_context) / '.nvmrc'
    return nvmrc_path.exists()


def detect_testable_services(services):
    """Detect services with real test scripts in package.json."""
    testable = []
    for service in services:
        service_name = service.get('service_name')
        build_context = service.get('build_context')

        if not service_name or not build_context:
            continue

        package_json_path = Path(build_context) / 'package.json'
        if not package_json_path.exists():
            continue

        try:
            if validate_package_json(str(package_json_path)):
                testable.append(service_name)
        except Exception as e:
            logger.warning(f"Error validating package.json for {service_name}: {e}")
            continue

    return testable


def main():
    """Main orchestration logic."""
    args = parse_args()

    try:
        # Step 1: Discover base images
        logger.info("Discovering base images...")
        base_images_path = Path(args.base_images_dir)
        base_images = discover_base_images(base_images_path)
        logger.info(f"Found {len(base_images)} base images")

        # Get list of all base image directories
        all_base_image_dirs = [img['directory'] for img in base_images]

        # Build directory to GHCR mapping
        base_image_mapping = build_directory_to_ghcr_mapping(base_images_path)
        logger.info(f"Built mapping for {len(base_image_mapping['dir_to_ghcr'])} base images")

        # Step 2: Discover services from docker-compose.yml
        logger.info("Discovering services from docker-compose.yml...")
        services = discover_services_from_compose(args.compose_file)
        logger.info(f"Found {len(services)} services")

        # Step 3: Detect changed base images
        logger.info(f"Detecting changed base images (comparing to {args.base_ref})...")
        # Convert base_images list to format expected by detect_changed_base_images
        base_images_for_detection = [
            {'directory': img['directory'], 'name': img['directory']}
            for img in base_images
        ]
        changed_base_dirs = detect_changed_base_images(args.base_ref, base_images_for_detection)
        logger.info(f"Changed base images: {changed_base_dirs}")

        # Step 4: Detect changed services
        logger.info(f"Detecting changed services (comparing to {args.base_ref})...")
        # Convert services list to format expected by detect_changed_services
        services_for_detection = [
            {'directory': service['build_context'], 'name': service['service_name']}
            for service in services
        ]
        changed_services = detect_changed_services(args.base_ref, services_for_detection)
        logger.info(f"Changed services: {changed_services}")

        # Step 5: Build reverse dependency map
        logger.info("Building reverse dependency map...")
        reverse_deps = build_reverse_dependency_map(services, base_image_mapping)
        logger.info(f"Built reverse dependencies for {len(reverse_deps)} base images")

        # Step 6: Detect affected services (services depending on changed base images)
        logger.info("Detecting affected services...")
        affected_services = detect_affected_services(changed_base_dirs, reverse_deps, base_image_mapping)
        logger.info(f"Affected services: {affected_services}")

        # Step 7: Determine base images needed for fork PRs
        base_images_needed = []
        if args.is_fork and changed_base_dirs:
            logger.info("Determining base images needed for fork PR...")
            base_images_needed = [
                base_image_mapping['dir_to_ghcr'][dir_name]
                for dir_name in changed_base_dirs
                if dir_name in base_image_mapping['dir_to_ghcr']
            ]
            logger.info(f"Base images needed: {base_images_needed}")

            try:
                validate_fork_pr_base_images(args.is_fork, base_images_needed)
                logger.info("Fork PR validation passed")
            except GHCRError as e:
                logger.error(f"Fork PR validation failed: {e}")
                sys.exit(1)

        # Step 8: Check GHCR for existing images
        logger.info("Checking GHCR for existing images...")
        # Combine changed and affected services
        all_services_to_check = sorted(set(changed_services + affected_services))
        services_to_check = [s for s in services if s['service_name'] in all_services_to_check]

        services_to_build = []
        services_to_retag = []

        if services_to_check:
            try:
                to_build, to_retag = check_all_services(
                    services_to_check,
                    args.base_sha
                )
                services_to_build = [s['service_name'] for s in to_build]
                services_to_retag = [s['service_name'] for s in to_retag]
                logger.info(f"Services to build: {services_to_build}")
                logger.info(f"Services to retag: {services_to_retag}")
            except GHCRError as e:
                logger.warning(f"GHCR check failed: {e}")
                # On error, assume all services need building
                services_to_build = all_services_to_check
                services_to_retag = []

        # Step 9: Detect testable services (have package.json with real tests)
        logger.info("Detecting testable services...")
        testable_services = detect_testable_services(services)
        logger.info(f"Testable services: {testable_services}")

        # Step 10: Detect healthcheck services
        logger.info("Detecting healthcheck services...")
        healthcheck_services = []
        for service in services:
            dockerfile_path = service['dockerfile_path']
            try:
                with open(dockerfile_path, 'r') as f:
                    dockerfile_content = f.read()
                if has_healthcheck(dockerfile_content):
                    healthcheck_services.append(service['service_name'])
            except (FileNotFoundError, IOError):
                logger.warning(f"Could not read Dockerfile for {service['service_name']}")
                continue
        logger.info(f"Healthcheck services: {healthcheck_services}")

        # Step 11: Detect version check services (.nvmrc + node base)
        logger.info("Detecting version check services...")
        version_check_services = []
        for service in services:
            # Check if has .nvmrc
            if not has_nvmrc(service['build_context']):
                continue

            # Check if uses node base image
            dockerfile_path = service['dockerfile_path']
            try:
                with open(dockerfile_path, 'r') as f:
                    dockerfile_content = f.read()
                base_image = extract_final_stage_base(dockerfile_content)
                if base_image and 'node' in base_image.lower():
                    version_check_services.append(service['service_name'])
            except (FileNotFoundError, IOError):
                logger.warning(f"Could not read Dockerfile for {service['service_name']}")
                continue
        logger.info(f"Version check services: {version_check_services}")

        # Step 12: Generate outputs
        logger.info("Generating outputs...")

        detection_result = {
            'base_images': all_base_image_dirs,
            'changed_base_images': changed_base_dirs,
            'base_images_needed': base_images_needed,
            'changed_services': changed_services,
            'affected_services': affected_services,
            'to_build': services_to_build,
            'to_retag': services_to_retag,
            'testable_services': testable_services,
            'healthcheck_services': healthcheck_services,
            'version_check_services': version_check_services,
        }

        outputs = generate_outputs(detection_result)

        # Validate outputs before writing
        validate_outputs(outputs)

        # Step 13: Write outputs
        logger.info("Writing outputs...")
        write_github_output(outputs, args.output_file)
        logger.info("Detection completed successfully")

    except Exception as e:
        logger.error(f"Detection failed: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
