# DMX Driver Docker Image Optimization

## Summary

Successfully reduced dmx-driver Docker image size from **1.01GB to 137MB** - an **86.4% reduction** (873MB saved).

## Root Cause Analysis

The original image was bloated due to:

1. **Wrong base image**: Used `ghcr.io/groupsky/homy/node-ubuntu:18.12.1` (full Ubuntu with build tools)
   - 529MB: Build tools (g++, gcc, imagemagick, tons of dev libraries)
   - 152MB: Git, mercurial, openssh, subversion
   - 149MB: Node.js installation

2. **Ineffective multi-stage build**: Build stage used same large base, keeping all build dependencies in final image

3. **Outdated Node.js version**: Using 18.12.1 instead of 18.20.8

## Optimization Strategy

### 1. Alpine Linux Migration

Switched from Ubuntu-based to Alpine-based Node.js image:
- **Before**: `ghcr.io/groupsky/homy/node-ubuntu:18.12.1` (base ~830MB)
- **After**: `ghcr.io/groupsky/homy/node:18.20.8-alpine` (base 127MB)

Alpine advantages for this use case:
- Much smaller base image size (~5MB vs ~100MB for Ubuntu)
- Still supports native Node.js modules with proper build tools
- libftdi1 available in Alpine repositories

Sources:
- [Choosing the best Node.js Docker image | Snyk](https://snyk.io/blog/choosing-the-best-node-js-docker-image/)
- [How to Reduce Docker Image Size: 6 Optimization Methods](https://devopscube.com/reduce-docker-image-size/)
- [Docker Image Size Optimization For Your Node.js App](https://webbylab.com/blog/minimal-size-docker-image-for-your-nodejs-app/)

### 2. Proper Multi-Stage Build

Implemented true separation between build and runtime stages:

**Build Stage**:
- Install build dependencies (python3, make, g++, linux-headers, pkgconf, libftdi1-dev)
- Compile native modules (node-dmx with libftdi bindings)
- Copy only production node_modules to clean location
- Remove all build tools before final layer

**Runtime Stage**:
- Only install runtime libftdi1 (~306KB)
- Copy pre-compiled node_modules from build stage
- No build tools, compilers, or development headers

### 3. Native Dependencies Handling

The node-dmx package requires libftdi for USB DMX device communication. Key challenges resolved:

**Header location**: Alpine libftdi1-dev places headers in `/usr/include/libftdi1/` instead of `/usr/include/`
- Solution: Export `CXXFLAGS` with pkg-config to add correct include paths

**Library naming**: node-dmx binding.gyp links against `-lftdi` but Alpine uses `-lftdi1`
- Solution: Create temporary symlink during build, remove before cleanup

**Alpine packages needed**:
- Runtime: `libftdi1` (1.5-r4)
- Build: `libftdi1-dev`, `pkgconf`, `python3`, `make`, `g++`, `linux-headers`

Sources:
- [libftdi1 - Alpine Linux packages](https://pkgs.alpinelinux.org/package/edge/community/x86/libftdi1)
- [node-gyp support in alpine linux - DEV Community](https://dev.to/grigorkh/node-gyp-support-in-alpine-linux-4d0f)

## Implementation Details

### Dockerfile Changes

```dockerfile
# Build stage - includes all compile-time dependencies
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS build

RUN apk add --no-cache --virtual .build-deps \
    python3 make g++ linux-headers pkgconf libftdi1-dev && \
    ln -s /usr/lib/libftdi1.so /usr/lib/libftdi.so && \
    export CXXFLAGS="$(pkg-config --cflags libftdi1)" && \
    export LDFLAGS="$(pkg-config --libs libftdi1)" && \
    npm ci --omit=dev && \
    cp -R node_modules prod_node_modules && \
    rm /usr/lib/libftdi.so && \
    apk del .build-deps

# Runtime stage - only runtime dependencies
FROM base AS release

RUN apk add --no-cache libftdi1 && \
    # User setup...

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
```

### Node.js Version Update

Updated from Node.js 18.12.1 to 18.20.8:
- Security patches and bug fixes
- Better npm support (10.8.2 vs older version)
- Aligns with project's other services

## Results

### Size Breakdown

**Original Image (1.01GB)**:
- 529MB: Build tools and libraries
- 152MB: VCS tools (git, mercurial, etc.)
- 149MB: Node.js
- 9.9MB: node_modules
- Rest: System libraries

**Optimized Image (137MB)**:
- 127MB: Alpine Node.js base
- 9.82MB: node_modules
- 306KB: libftdi1 runtime + user setup
- Rest: Minimal Alpine system

### Performance Impact

- **Build time**: Slightly longer due to native compilation, but build stage is properly separated
- **Runtime performance**: No impact - same Node.js runtime, same native modules
- **CI/CD**: 873MB less to pull/push per build
- **Storage**: 873MB saved per image tag

## Testing

Comprehensive test suite created to verify functionality:
- DMX device initialization
- MQTT connection handling
- Message parsing and DMX channel mapping
- Error handling and process lifecycle

Tests cover all critical paths to ensure optimization didn't break functionality.

## Lessons Learned

1. **Choose the right base image**: Ubuntu-based images include massive toolchains meant for development, not production
2. **Alpine native modules work**: With correct build flags and package names, Alpine can compile complex native modules
3. **Multi-stage builds need true separation**: Don't base final stage on build-heavy image
4. **Always measure**: Docker history analysis revealed the actual bloat sources
5. **Test before optimizing**: Having tests ensures optimization doesn't break functionality

## Future Considerations

1. **Distroless option**: Could explore distroless Node.js images for even smaller size
2. **Node.js 22**: Consider upgrading to Node.js 22 LTS when stable
3. **Base image standardization**: Use this pattern for other services with native dependencies

## Related Documentation

- [Base Images Policy](../../base-images/CLAUDE.md)
- [Docker Services Development Guide](../CLAUDE.md)
- [InfluxDB Schema Documentation](../../docs/influxdb-schema.md)
