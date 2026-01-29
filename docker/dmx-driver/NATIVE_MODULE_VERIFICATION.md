# Native Module Verification

## Purpose

The `verify-native-module.test.js` test suite validates that the node-dmx native C++ addon compiles correctly on Alpine Linux and can load the libftdi1 library **without requiring physical hardware**.

## What It Tests

### ✅ Native Module Loading
- Native C++ addon loads without crashes
- No "cannot load shared library" errors
- No undefined symbol errors (ABI compatibility)

### ✅ libftdi1 Integration
- `DMX.list()` function works (enumerates FTDI devices)
- libftdi1 shared library is accessible
- No segmentation faults from library calls

### ✅ Runtime Environment
- Alpine Linux with musl libc
- libftdi1 runtime library installed
- Correct Node.js version from .nvmrc
- x64 architecture

## What It Does NOT Test

### ❌ Hardware Communication
- DMX() constructor (throws TypeError without FTDI device)
- USB device detection and permissions
- Actual DMX channel control
- FTDI USB-RS485 cable communication

### ❌ Production Functionality
- MQTT connection and message handling (covered by index.test.js)
- Bit-to-channel mapping (covered by index.test.js)
- Error handling (covered by index.test.js)

## CI Integration

### Automatic Detection

The unified CI workflow (`ci-unified.yml`) automatically:
1. Detects that dmx-driver has `package.json` with real test script
2. Adds dmx-driver to `testable_services` array (Stage 1)
3. Runs `npm test` inside the built Docker image (Stage 4B)
4. Blocks `:latest` tag promotion if tests fail

### When Tests Run

Tests execute in **Stage 4B: Unit Tests** when:
- dmx-driver Dockerfile or code changes
- Base image (`node:18.20.8-alpine`) changes
- Workflow files change

### How Tests Run

```yaml
# Stage 4B: Unit Tests
docker run --rm \
  -v "$(pwd):/app" \
  -w /app \
  ghcr.io/groupsky/homy/dmx-driver:$SHA \
  npm test
```

**Key Points:**
- Tests run in the actual Alpine container (not host OS)
- Verifies native module in exact production environment
- Uses musl libc, not glibc
- Artifact-based: no GHCR push permission required

## Why NOT a Docker HEALTHCHECK?

### ❌ Not Suitable as HEALTHCHECK

The dmx-driver service **does not have a health endpoint** and a HEALTHCHECK is not appropriate because:

1. **No HTTP Server**: dmx-driver is an MQTT client, not a server
2. **External Dependencies**: Health depends on MQTT broker availability (out of scope)
3. **Hardware Requirements**: Cannot verify DMX communication without USB device
4. **Continuous Operation**: Service runs continuously, no periodic health state

### ✅ What Would Be Appropriate

If dmx-driver were to have a HEALTHCHECK, it would need:
- An HTTP health endpoint (e.g., `http://localhost:3000/health`)
- A health check script that doesn't require hardware
- A way to verify MQTT connection status

**Example (NOT implemented):**
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('dmx').DMX.list(); process.exit(0)" || exit 1
```

However, this only verifies the native module loads, not that the service is functioning.

## Hardware Validation (Post-Merge)

The native module verification provides **95% confidence** the image works. The remaining 5% requires hardware testing:

### Critical Validation Steps

1. **USB Device Detection**
   ```bash
   docker run --rm --privileged \
     -v /dev/bus/usb:/dev/bus/usb \
     ghcr.io/groupsky/homy/dmx-driver:latest \
     node -e "console.log(require('dmx').DMX.list())"
   ```
   Expected: Array with FTDI device info

2. **DMX Channel Control**
   - Deploy to test environment with actual DMX hardware
   - Publish MQTT messages to trigger channel changes
   - Verify DMX devices respond correctly

3. **24+ Hour Stability Test**
   - Monitor for crashes, USB errors, timing issues
   - Check for memory leaks
   - Validate reconnection behavior

### Rollback Plan

If hardware testing reveals issues:
```bash
# Rollback to previous version
docker pull ghcr.io/groupsky/homy/dmx-driver:previous-sha
docker tag ghcr.io/groupsky/homy/dmx-driver:previous-sha \
           ghcr.io/groupsky/homy/dmx-driver:latest
```

## Troubleshooting

### Test Failures

**"cannot load shared library libftdi1.so.2"**
- libftdi1 not installed in Dockerfile
- Check `RUN apk add --no-cache libftdi1` in release stage

**"undefined symbol: ftdi_usb_open"**
- Native module compiled incorrectly
- ABI mismatch between build and runtime
- Check build stage has libftdi1-dev and correct CXXFLAGS/LDFLAGS

**"DMX.list() crashes"**
- libftdi1 version incompatibility
- Missing USB libraries
- Check Alpine package versions

### Local Testing

To run tests locally (requires dependencies installed):
```bash
cd docker/dmx-driver
npm ci  # Install dependencies including Jest
npm test  # Run all tests including native module verification
```

To test in Docker container (recommended):
```bash
cd docker/dmx-driver
docker build -t dmx-driver-test .
docker run --rm -v "$(pwd):/app" -w /app dmx-driver-test npm test
```

## References

- **node-dmx fork**: https://github.com/groupsky/node-dmx (v1.0.2)
- **libftdi library**: https://www.intra2net.com/en/developer/libftdi/
- **Alpine packages**: https://pkgs.alpinelinux.org/packages?name=libftdi1
- **Unified CI workflow**: `.github/workflows/ci-unified.yml` (Stage 4B)
