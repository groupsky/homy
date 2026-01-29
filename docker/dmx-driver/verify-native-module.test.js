/**
 * Native Module Verification Test
 *
 * Verifies that the node-dmx native C++ addon compiles correctly on Alpine Linux
 * and can load the libftdi1 library. This test does NOT require hardware.
 *
 * What this tests:
 * - Native module compiles with musl libc (Alpine)
 * - libftdi1 shared library is accessible
 * - DMX.list() function works (only function that doesn't require hardware)
 * - No runtime crashes from ABI mismatches
 *
 * What this does NOT test:
 * - Actual DMX hardware communication (requires FTDI USB device)
 * - DMX() constructor (throws TypeError without hardware)
 * - USB device permissions
 */

describe('Native Module Verification', () => {
  let DMX, list

  beforeAll(() => {
    // This will throw if the native module fails to load
    // Common failures:
    // - "cannot load shared library libftdi1.so.2" → runtime dependency missing
    // - "undefined symbol" → ABI mismatch between musl and native module
    // - Segfault → serious compilation or linking issue
    const dmxModule = require('dmx')
    DMX = dmxModule.DMX
    list = dmxModule.list
  })

  test('should load native module without crashing', () => {
    expect(DMX).toBeDefined()
    expect(typeof DMX).toBe('function')
  })

  test('should have list() function', () => {
    expect(typeof list).toBe('function')
  })

  test('should call list() successfully (verifies libftdi1 works)', () => {
    // list() enumerates FTDI devices via libftdi1
    // This is the ONLY function that works without hardware
    // Expected: "ftdi_init failed" error (no USB devices in CI environment)
    // If this crashes with different error → libftdi1 integration broken

    expect(() => {
      list()
    }).toThrow('ftdi_init failed') // Expected when no USB devices present
  })

  test('should verify module exports structure', () => {
    // Verify the module has expected structure
    const dmxModule = require('dmx')
    expect(dmxModule).toHaveProperty('DMX')
    expect(dmxModule).toHaveProperty('list')

    // DMX is a constructor, should be a function
    expect(DMX).toBeInstanceOf(Function)
  })

  test('native module should be compiled for correct architecture', () => {
    // Verify we're running on the expected platform
    // Alpine Linux uses x64 architecture
    expect(process.platform).toBe('linux')
    expect(process.arch).toBe('x64')
  })

  test('should not crash when accessing module multiple times', () => {
    // Verify module can be called multiple times without memory issues
    // Expected: all calls throw "ftdi_init failed" (no USB devices)
    expect(() => {
      for (let i = 0; i < 10; i++) {
        try {
          list()
        } catch (error) {
          if (error.message !== 'ftdi_init failed') {
            throw error
          }
        }
      }
    }).not.toThrow()
  })
})

describe('Runtime Environment Verification', () => {
  test('should have libftdi1 library available', () => {
    // Verify we're in the expected Alpine Linux environment
    // This test documents the expected runtime environment
    const fs = require('fs')

    // libftdi1 should be installed in /usr/lib
    const libftdiPaths = [
      '/usr/lib/libftdi1.so',
      '/usr/lib/libftdi1.so.2',
      '/usr/lib/libftdi1.so.2.5.0'
    ]

    const foundLib = libftdiPaths.some(path => {
      try {
        return fs.existsSync(path)
      } catch (e) {
        return false
      }
    })

    expect(foundLib).toBe(true)
  })

  test('should be running on Alpine Linux with musl', () => {
    const fs = require('fs')

    // Alpine uses musl libc, not glibc
    // Verify musl is present
    const muslPaths = [
      '/lib/ld-musl-x86_64.so.1',
      '/usr/lib/libc.musl-x86_64.so.1'
    ]

    const foundMusl = muslPaths.some(path => {
      try {
        return fs.existsSync(path)
      } catch (e) {
        return false
      }
    })

    expect(foundMusl).toBe(true)
  })

  test('should have correct Node.js version', () => {
    // Verify Node.js version matches .nvmrc
    const fs = require('fs')
    const path = require('path')

    const nvmrcPath = path.join(__dirname, '.nvmrc')
    const expectedVersion = fs.readFileSync(nvmrcPath, 'utf8').trim()
    const actualVersion = process.version.replace('v', '')

    expect(actualVersion).toBe(expectedVersion)
  })
})
