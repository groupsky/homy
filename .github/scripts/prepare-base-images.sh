#!/bin/bash
set -euo pipefail

# Stage 2: Base Image Preparation Script
# Handles sequential building, caching, validation, and artifact creation for base images
#
# Input parameters:
#   BASE_IMAGES_JSON: JSON array of base image objects with 'name', 'version', 'type' fields
#   BASE_IMAGES_DIR: Path to base-images directory
#   SHOULD_PUSH: Whether to push to GHCR (true for master branch)
#   GHCR_TOKEN: GitHub Container Registry authentication token
#   TELEGRAM_WEBHOOK: Optional Telegram webhook URL for GHCR 503 notifications

# Color codes for better output readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
MAX_ARTIFACT_SIZE_MB=500
MAX_TOTAL_SIZE_MB=1500
ARTIFACT_DIR="artifacts"
RETRY_ATTEMPTS=3
RETRY_DELAY=5

# Global counters
TOTAL_SIZE_MB=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $*"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $*"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

log_step() {
    echo -e "${BLUE}==>${NC} $*"
}

# Send Telegram notification for GHCR 503 errors
send_telegram_notification() {
    local message="$1"

    if [[ -z "${TELEGRAM_WEBHOOK:-}" ]]; then
        log_warning "TELEGRAM_WEBHOOK not set, skipping notification"
        return 0
    fi

    log_info "Sending Telegram notification"

    # Format message for Telegram
    local payload=$(cat <<EOF
{
    "text": "🔴 GHCR Service Unavailable\n\n${message}\n\nWorkflow: ${GITHUB_WORKFLOW:-unknown}\nRun: ${GITHUB_RUN_ID:-unknown}"
}
EOF
)

    if curl -sf -X POST \
        -H "Content-Type: application/json" \
        -d "$payload" \
        "$TELEGRAM_WEBHOOK" > /dev/null; then
        log_success "Telegram notification sent"
    else
        log_warning "Failed to send Telegram notification"
    fi
}

# Authenticate with GitHub Container Registry
authenticate_ghcr() {
    local token="$1"

    log_step "Authenticating with GHCR"

    if echo "$token" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin; then
        log_success "GHCR authentication successful"
        return 0
    else
        log_error "GHCR authentication failed"
        return 1
    fi
}

# Check if GHCR is available by attempting a simple pull
check_ghcr_availability() {
    log_step "Checking GHCR availability"

    # Try to pull a known small image to test connectivity
    if docker pull ghcr.io/groupsky/homy/alpine:latest &> /dev/null; then
        log_success "GHCR is available"
        docker rmi ghcr.io/groupsky/homy/alpine:latest &> /dev/null || true
        return 0
    else
        log_warning "GHCR availability check failed"
        return 1
    fi
}

# Restore cached image from previous builds
restore_cache() {
    local image_name="$1"
    local image_version="$2"
    local cache_key="base-image-${image_name}-${image_version}"

    log_step "Checking for cached image: ${cache_key}"

    # GitHub Actions cache is handled by the workflow
    # This function is a placeholder for future enhancements
    # For now, we rely on Docker's layer caching

    log_info "Cache restoration handled by workflow-level actions/cache"
    return 0
}

# Pull image from source registry with retry logic
pull_source_image() {
    local source_image="$1"
    local attempt=1

    log_step "Pulling source image: ${source_image}"

    while [[ $attempt -le $RETRY_ATTEMPTS ]]; do
        log_info "Attempt ${attempt}/${RETRY_ATTEMPTS}"

        if docker pull "$source_image" 2>&1 | tee /tmp/docker_pull.log; then
            log_success "Successfully pulled ${source_image}"
            return 0
        fi

        # Check for GHCR 503 errors
        if grep -q "503 Service Unavailable" /tmp/docker_pull.log || \
           grep -q "received unexpected HTTP status: 503" /tmp/docker_pull.log; then
            log_error "GHCR returned 503 Service Unavailable"

            # Send notification on first 503 error
            if [[ $attempt -eq 1 ]]; then
                send_telegram_notification "Failed to pull ${source_image} from GHCR (503 error). Will retry and fallback to Docker Hub if needed."
            fi

            # Wait before retry
            if [[ $attempt -lt $RETRY_ATTEMPTS ]]; then
                log_info "Waiting ${RETRY_DELAY}s before retry..."
                sleep $RETRY_DELAY
                ((attempt++))
                continue
            fi

            # All retries exhausted, return error code for 503
            return 2
        fi

        # Other errors
        log_warning "Pull failed, retrying..."
        if [[ $attempt -lt $RETRY_ATTEMPTS ]]; then
            sleep $RETRY_DELAY
            ((attempt++))
        else
            log_error "Failed to pull ${source_image} after ${RETRY_ATTEMPTS} attempts"
            return 1
        fi
    done

    return 1
}

# Build image from Dockerfile (fallback when pull fails)
build_from_dockerfile() {
    local base_images_dir="$1"
    local image_name="$2"
    local image_version="$3"
    local target_image="$4"

    log_step "Building image from Dockerfile: ${image_name}:${image_version}"

    local dockerfile_path="${base_images_dir}/${image_name}/Dockerfile"

    if [[ ! -f "$dockerfile_path" ]]; then
        log_error "Dockerfile not found: ${dockerfile_path}"
        return 1
    fi

    # Build with version tag
    if docker build \
        --build-arg VERSION="${image_version}" \
        -t "$target_image" \
        -f "$dockerfile_path" \
        "${base_images_dir}/${image_name}"; then
        log_success "Successfully built ${target_image}"
        return 0
    else
        log_error "Failed to build ${target_image}"
        return 1
    fi
}

# Validate image exists and is functional
validate_image() {
    local image="$1"

    log_step "Validating image: ${image}"

    # Check if image exists
    if ! docker image inspect "$image" > /dev/null 2>&1; then
        log_error "Image does not exist: ${image}"
        return 1
    fi

    # Get image size
    local size_bytes=$(docker image inspect "$image" --format='{{.Size}}')
    local size_mb=$((size_bytes / 1024 / 1024))

    log_info "Image size: ${size_mb}MB"

    # Basic validation: try to create a container (but don't run it)
    if docker create --rm "$image" true > /dev/null 2>&1; then
        log_success "Image validation successful"
        # Clean up the created container
        docker rm $(docker ps -lq) > /dev/null 2>&1 || true
        return 0
    else
        log_error "Image validation failed: cannot create container"
        return 1
    fi
}

# Generate checksum for image tarball
generate_checksum() {
    local tarball="$1"
    local checksum_file="${tarball}.sha256"

    log_step "Generating SHA-256 checksum"

    if sha256sum "$tarball" > "$checksum_file"; then
        local checksum=$(cut -d' ' -f1 "$checksum_file")
        log_success "Checksum: ${checksum}"
        return 0
    else
        log_error "Failed to generate checksum"
        return 1
    fi
}

# Save image to tarball artifact
save_image_artifact() {
    local image="$1"
    local artifact_name="$2"
    local tarball="${ARTIFACT_DIR}/${artifact_name}.tar"

    log_step "Saving image to tarball: ${tarball}"

    # Create artifact directory
    mkdir -p "$ARTIFACT_DIR"

    # Save image
    if docker save "$image" -o "$tarball"; then
        log_success "Image saved to tarball"
    else
        log_error "Failed to save image"
        return 1
    fi

    # Generate checksum
    if ! generate_checksum "$tarball"; then
        return 1
    fi

    # Check artifact size
    local size_bytes=$(stat -f%z "$tarball" 2>/dev/null || stat -c%s "$tarball" 2>/dev/null)
    local size_mb=$((size_bytes / 1024 / 1024))

    log_info "Artifact size: ${size_mb}MB"

    if [[ $size_mb -gt $MAX_ARTIFACT_SIZE_MB ]]; then
        log_error "Artifact exceeds maximum size of ${MAX_ARTIFACT_SIZE_MB}MB"
        return 1
    fi

    # Update total size
    TOTAL_SIZE_MB=$((TOTAL_SIZE_MB + size_mb))

    log_info "Total artifacts size: ${TOTAL_SIZE_MB}MB / ${MAX_TOTAL_SIZE_MB}MB"

    if [[ $TOTAL_SIZE_MB -gt $MAX_TOTAL_SIZE_MB ]]; then
        log_error "Total artifacts size exceeds maximum of ${MAX_TOTAL_SIZE_MB}MB"
        return 1
    fi

    if [[ $TOTAL_SIZE_MB -gt $((MAX_TOTAL_SIZE_MB * 80 / 100)) ]]; then
        log_warning "Total size approaching limit (${TOTAL_SIZE_MB}MB / ${MAX_TOTAL_SIZE_MB}MB)"
    fi

    # Output artifact info for workflow
    echo "artifact_name=${artifact_name}" >> "${GITHUB_OUTPUT:-/dev/null}"
    echo "artifact_path=${tarball}" >> "${GITHUB_OUTPUT:-/dev/null}"
    echo "artifact_size_mb=${size_mb}" >> "${GITHUB_OUTPUT:-/dev/null}"

    return 0
}

# Push image to GHCR (master branch only)
push_to_ghcr() {
    local image="$1"
    local should_push="$2"

    if [[ "$should_push" != "true" ]]; then
        log_info "Skipping push (not on master branch)"
        return 0
    fi

    log_step "Pushing to GHCR: ${image}"

    if docker push "$image"; then
        log_success "Successfully pushed to GHCR"
        return 0
    else
        log_error "Failed to push to GHCR"
        return 1
    fi
}

# Process a single base image
process_base_image() {
    local base_images_dir="$1"
    local image_obj="$2"
    local should_push="$3"
    local current="$4"
    local total="$5"

    # Parse image object (expecting JSON with name, version, type fields)
    local image_name=$(echo "$image_obj" | jq -r '.name')
    local image_version=$(echo "$image_obj" | jq -r '.version')
    local image_type=$(echo "$image_obj" | jq -r '.type')
    local source_image=$(echo "$image_obj" | jq -r '.source // empty')

    # Generate target image name
    local target_image="ghcr.io/groupsky/homy/${image_name}:${image_version}"
    local artifact_name="base-image-${image_name}-${image_version}"

    # Start progress group
    echo "::group::Preparing ${image_name}:${image_version} (${current}/${total}) [${image_type}]"

    log_info "Starting at $(date '+%Y-%m-%d %H:%M:%S')"
    log_info "Type: ${image_type}"
    log_info "Target: ${target_image}"

    # Restore cache
    restore_cache "$image_name" "$image_version"

    # Determine if we need to pull or build
    local needs_build=false
    local ghcr_503=false

    if [[ -n "$source_image" ]]; then
        # Try to pull from source
        if ! pull_source_image "$source_image"; then
            local pull_result=$?

            if [[ $pull_result -eq 2 ]]; then
                # GHCR 503 error
                ghcr_503=true
                log_warning "GHCR unavailable (503), falling back to build from Dockerfile"
                needs_build=true
            else
                # Other error
                log_error "Failed to pull source image, trying build from Dockerfile"
                needs_build=true
            fi
        else
            # Successfully pulled, tag it
            log_step "Tagging image: ${source_image} -> ${target_image}"
            if ! docker tag "$source_image" "$target_image"; then
                log_error "Failed to tag image"
                echo "::endgroup::"
                return 1
            fi
        fi
    else
        # No source image specified, must build
        needs_build=true
    fi

    # Build from Dockerfile if needed
    if [[ "$needs_build" = true ]]; then
        if ! build_from_dockerfile "$base_images_dir" "$image_name" "$image_version" "$target_image"; then
            log_error "Failed to build image"
            echo "::endgroup::"
            return 1
        fi
    fi

    # Validate image
    if ! validate_image "$target_image"; then
        log_error "Image validation failed"
        echo "::endgroup::"
        return 1
    fi

    # Save artifact
    if ! save_image_artifact "$target_image" "$artifact_name"; then
        log_error "Failed to save artifact"
        echo "::endgroup::"
        return 1
    fi

    # Push to GHCR if on master
    if ! push_to_ghcr "$target_image" "$should_push"; then
        log_warning "Failed to push to GHCR (non-fatal)"
    fi

    # Clean up local image to save space
    log_step "Cleaning up local images"
    docker rmi "$target_image" > /dev/null 2>&1 || true
    if [[ -n "$source_image" ]]; then
        docker rmi "$source_image" > /dev/null 2>&1 || true
    fi

    log_success "Completed at $(date '+%Y-%m-%d %H:%M:%S')"

    # End progress group
    echo "::endgroup::"

    return 0
}

# Main function
main() {
    log_info "Starting base image preparation (Stage 2)"
    log_info "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"

    # Validate required environment variables
    if [[ -z "${BASE_IMAGES_JSON:-}" ]]; then
        log_error "BASE_IMAGES_JSON environment variable is required"
        exit 1
    fi

    if [[ -z "${BASE_IMAGES_DIR:-}" ]]; then
        log_error "BASE_IMAGES_DIR environment variable is required"
        exit 1
    fi

    if [[ -z "${SHOULD_PUSH:-}" ]]; then
        log_error "SHOULD_PUSH environment variable is required"
        exit 1
    fi

    if [[ -z "${GHCR_TOKEN:-}" ]]; then
        log_error "GHCR_TOKEN environment variable is required"
        exit 1
    fi

    # Authenticate with GHCR
    if ! authenticate_ghcr "$GHCR_TOKEN"; then
        log_error "Failed to authenticate with GHCR"
        exit 1
    fi

    # Parse base images JSON array
    local images_count=$(echo "$BASE_IMAGES_JSON" | jq 'length')

    log_info "Total images to process: ${images_count}"

    if [[ $images_count -eq 0 ]]; then
        log_info "No images to process"
        exit 0
    fi

    # Process each image sequentially
    local current=1
    local failed=0

    while [[ $current -le $images_count ]]; do
        local index=$((current - 1))
        local image_obj=$(echo "$BASE_IMAGES_JSON" | jq ".[$index]")

        if ! process_base_image "$BASE_IMAGES_DIR" "$image_obj" "$SHOULD_PUSH" "$current" "$images_count"; then
            log_error "Failed to process image ${current}/${images_count}"
            ((failed++))
        fi

        ((current++))
    done

    # Summary
    log_info "=========================================="
    log_info "Base Image Preparation Summary"
    log_info "=========================================="
    log_info "Total images: ${images_count}"
    log_info "Successful: $((images_count - failed))"
    log_info "Failed: ${failed}"
    log_info "Total artifacts size: ${TOTAL_SIZE_MB}MB"
    log_info "=========================================="

    if [[ $failed -gt 0 ]]; then
        log_error "Some images failed to process"
        exit 1
    fi

    log_success "All images processed successfully"
    exit 0
}

# Run main function
main "$@"
