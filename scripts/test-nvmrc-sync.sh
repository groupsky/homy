#!/bin/bash
#
# Test script for .nvmrc synchronization with Docker Node.js base images
#
# Usage:
#   ./scripts/test-nvmrc-sync.sh [service-directory]
#
# Examples:
#   ./scripts/test-nvmrc-sync.sh docker/automations
#   ./scripts/test-nvmrc-sync.sh  # Tests all services with .nvmrc files
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to extract Node.js version from Dockerfile
extract_node_version() {
    local dockerfile="$1"

    if [ ! -f "$dockerfile" ]; then
        echo ""
        return 1
    fi

    # Extract version from FROM line with node base image
    # Supports both:
    #   - ghcr.io/groupsky/homy/node:18.20.8-alpine
    #   - ghcr.io/groupsky/homy/node-ubuntu:18.20.8
    local version=$(grep -E "^FROM.*node(-[a-z]+)?:" "$dockerfile" | tail -1 | sed -E 's/.*node(-[a-z]+)?:([0-9.]+).*/\2/')

    if [ -z "$version" ]; then
        echo ""
        return 1
    fi

    echo "$version"
    return 0
}

# Function to check a single service directory
check_service() {
    local service_dir="$1"
    local dockerfile="${service_dir}/Dockerfile"
    local nvmrc="${service_dir}/.nvmrc"

    echo -e "\n${YELLOW}Checking: ${service_dir}${NC}"

    # Check if Dockerfile exists
    if [ ! -f "$dockerfile" ]; then
        echo -e "${RED}  ✗ Dockerfile not found${NC}"
        return 1
    fi

    # Extract Node.js version from Dockerfile
    local docker_version=$(extract_node_version "$dockerfile")

    if [ -z "$docker_version" ]; then
        echo -e "${YELLOW}  ⊗ No Node.js base image found in Dockerfile${NC}"
        return 0
    fi

    echo -e "  Docker Node.js version: ${GREEN}${docker_version}${NC}"

    # Check if .nvmrc exists
    if [ ! -f "$nvmrc" ]; then
        echo -e "${RED}  ✗ .nvmrc file not found${NC}"
        echo -e "${YELLOW}  → Should create .nvmrc with version: ${docker_version}${NC}"
        return 1
    fi

    # Read .nvmrc version
    local nvmrc_version=$(cat "$nvmrc" | tr -d '\n\r')
    echo -e "  .nvmrc version: ${GREEN}${nvmrc_version}${NC}"

    # Compare versions
    if [ "$docker_version" = "$nvmrc_version" ]; then
        echo -e "${GREEN}  ✓ Versions match${NC}"
        return 0
    else
        echo -e "${RED}  ✗ Version mismatch!${NC}"
        echo -e "${YELLOW}  → .nvmrc should be updated to: ${docker_version}${NC}"
        return 1
    fi
}

# Function to simulate Renovate's post-upgrade task
simulate_renovate_update() {
    local service_dir="$1"
    local dockerfile="${service_dir}/Dockerfile"
    local nvmrc="${service_dir}/.nvmrc"

    echo -e "\n${YELLOW}Simulating Renovate update for: ${service_dir}${NC}"

    # This is the exact command Renovate would run
    bash -c "if [ -f ${nvmrc} ]; then \
        NEW_VERSION=\$(grep \"^FROM.*node\" ${dockerfile} | sed -E \"s/.*node(-[a-z]+)?:([0-9.]+).*/\2/\"); \
        if [ ! -z \"\$NEW_VERSION\" ] && [ \"\$NEW_VERSION\" != \"\$(cat ${nvmrc})\" ]; then \
            echo \"\$NEW_VERSION\" > ${nvmrc} && echo \"Updated .nvmrc to \$NEW_VERSION\"; \
        else \
            echo \"No update needed (already synced)\"; \
        fi; \
    else \
        echo \"No .nvmrc file found, skipping\"; \
    fi"

    return $?
}

# Function to find all services with .nvmrc files
find_services_with_nvmrc() {
    find docker -maxdepth 2 -name ".nvmrc" -type f | sed 's|/.nvmrc||' | sort
}

# Main script
main() {
    echo -e "${GREEN}Node.js Version Synchronization Test${NC}"
    echo -e "${GREEN}=====================================${NC}"

    local exit_code=0

    if [ $# -eq 0 ]; then
        # Test all services with .nvmrc files
        echo -e "\nFinding all services with .nvmrc files...\n"

        local services=$(find_services_with_nvmrc)
        local total=0
        local passed=0
        local failed=0

        for service_dir in $services; do
            total=$((total + 1))
            if check_service "$service_dir"; then
                passed=$((passed + 1))
            else
                failed=$((failed + 1))
                exit_code=1
            fi
        done

        echo -e "\n${GREEN}=================================${NC}"
        echo -e "${GREEN}Summary${NC}"
        echo -e "${GREEN}=================================${NC}"
        echo -e "Total services checked: ${total}"
        echo -e "${GREEN}Passed: ${passed}${NC}"
        if [ $failed -gt 0 ]; then
            echo -e "${RED}Failed: ${failed}${NC}"
        else
            echo -e "Failed: ${failed}"
        fi

    else
        # Test specific service
        local service_dir="$1"

        if [ ! -d "$service_dir" ]; then
            echo -e "${RED}Error: Directory not found: ${service_dir}${NC}"
            exit 1
        fi

        if ! check_service "$service_dir"; then
            exit_code=1
        fi

        # Offer to simulate Renovate update
        echo -e "\n${YELLOW}Would you like to simulate a Renovate update? (y/N)${NC}"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            simulate_renovate_update "$service_dir"

            # Re-check after simulation
            echo -e "\n${YELLOW}Re-checking after simulation:${NC}"
            check_service "$service_dir"
        fi
    fi

    exit $exit_code
}

# Run main function
main "$@"
