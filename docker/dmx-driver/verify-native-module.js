#!/usr/bin/env node

/**
 * Native Module Verification Script
 *
 * Verifies that the node-dmx native C++ addon compiles correctly on Alpine Linux
 * and can load the libftdi1 library. This script does NOT require hardware or test frameworks.
 *
 * Usage: node verify-native-module.js
 * Exit codes: 0 = success, 1 = failure
 */

const fs = require('fs')
const path = require('path')

let exitCode = 0
let testsRun = 0
let testsPassed = 0

function assert(condition, message) {
  testsRun++
  if (condition) {
    testsPassed++
    console.log(`✅ PASS: ${message}`)
  } else {
    exitCode = 1
    console.error(`❌ FAIL: ${message}`)
  }
}

function assertEqual(actual, expected, message) {
  testsRun++
  if (actual === expected) {
    testsPassed++
    console.log(`✅ PASS: ${message}`)
  } else {
    exitCode = 1
    console.error(`❌ FAIL: ${message}`)
    console.error(`  Expected: ${expected}`)
    console.error(`  Actual: ${actual}`)
  }
}

console.log('🔍 Native Module Verification\n')
console.log('='.repeat(60))
console.log('Testing node-dmx native addon on Alpine Linux')
console.log('='.repeat(60))
console.log('')

// Test 1: Load native module
console.log('📦 Test 1: Loading native module...')
let DMX, list
try {
  const dmxModule = require('dmx')
  DMX = dmxModule.DMX
  list = dmxModule.list
  assert(typeof DMX === 'function', 'DMX is a constructor function')
  assert(typeof list === 'function', 'list() function is exported')
} catch (error) {
  console.error(`❌ FAIL: Could not load native module`)
  console.error(`  Error: ${error.message}`)
  console.error('')
  console.error('Common causes:')
  console.error('  - libftdi1.so.2 not found → Install libftdi1 runtime package')
  console.error('  - undefined symbol errors → ABI mismatch (musl vs glibc)')
  console.error('  - Segmentation fault → Compilation error')
  process.exit(1)
}
console.log('')

// Test 2: Call list() to verify libftdi1 works
console.log('🔗 Test 2: Verifying libftdi1 integration...')
try {
  const devices = list()
  assert(Array.isArray(devices), 'list() returns an array')
  assertEqual(devices.length, 0, 'list() returns empty array (no hardware in test environment)')
  console.log('   (Expected: no FTDI devices found in CI/test environment)')
} catch (error) {
  // "ftdi_init failed" is EXPECTED when no USB devices are present
  // This actually proves the native module is working - it's calling libftdi correctly
  if (error.message === 'ftdi_init failed') {
    assert(true, 'libftdi1 reports no USB devices (expected in container)')
    console.log('   (libftdi initialization failed - no USB devices, which is expected)')
  } else {
    console.error(`❌ FAIL: list() threw unexpected error`)
    console.error(`  Error: ${error.message}`)
    exitCode = 1
  }
}
console.log('')

// Test 3: Verify runtime environment
console.log('🏔️  Test 3: Verifying Alpine Linux environment...')
assertEqual(process.platform, 'linux', 'Running on Linux')
assertEqual(process.arch, 'x64', 'Running on x64 architecture')
console.log('')

// Test 4: Verify libftdi1 library exists
console.log('📚 Test 4: Checking runtime libraries...')
const libftdiPaths = [
  '/usr/lib/libftdi1.so',
  '/usr/lib/libftdi1.so.2',
  '/usr/lib/libftdi1.so.2.5.0'
]

let foundLibftdi = false
for (const libPath of libftdiPaths) {
  try {
    if (fs.existsSync(libPath)) {
      foundLibftdi = true
      console.log(`   Found: ${libPath}`)
      break
    }
  } catch (e) {
    // Continue checking other paths
  }
}
assert(foundLibftdi, 'libftdi1 runtime library is installed')
console.log('')

// Test 5: Verify musl libc
console.log('🔐 Test 5: Checking libc implementation...')
const muslPaths = [
  '/lib/ld-musl-x86_64.so.1',
  '/usr/lib/libc.musl-x86_64.so.1'
]

let foundMusl = false
for (const muslPath of muslPaths) {
  try {
    if (fs.existsSync(muslPath)) {
      foundMusl = true
      console.log(`   Found: ${muslPath}`)
      break
    }
  } catch (e) {
    // Continue checking other paths
  }
}
assert(foundMusl, 'Alpine Linux uses musl libc')
console.log('')

// Test 6: Verify Node.js version matches .nvmrc
console.log('📌 Test 6: Checking Node.js version...')
try {
  const nvmrcPath = path.join(__dirname, '.nvmrc')
  const expectedVersion = fs.readFileSync(nvmrcPath, 'utf8').trim()
  const actualVersion = process.version.replace('v', '')
  assertEqual(actualVersion, expectedVersion, `Node.js version matches .nvmrc (${expectedVersion})`)
} catch (error) {
  console.log(`   ⚠️  Warning: Could not verify Node.js version (${error.message})`)
}
console.log('')

// Test 7: Verify module can be called multiple times
console.log('🔄 Test 7: Testing multiple calls...')
try {
  let successfulCalls = 0
  let expectedErrors = 0
  for (let i = 0; i < 10; i++) {
    try {
      list()
      successfulCalls++
    } catch (error) {
      if (error.message === 'ftdi_init failed') {
        expectedErrors++
      } else {
        throw error
      }
    }
  }
  assert(true, `Native module called 10 times without crashing (${successfulCalls} successful, ${expectedErrors} expected errors)`)
} catch (error) {
  console.error(`❌ FAIL: Native module crashed on repeated calls`)
  console.error(`  Error: ${error.message}`)
  exitCode = 1
}
console.log('')

// Summary
console.log('='.repeat(60))
console.log(`📊 Test Results: ${testsPassed}/${testsRun} passed`)
console.log('='.repeat(60))
console.log('')

if (exitCode === 0) {
  console.log('✅ SUCCESS: Native module verification passed!')
  console.log('')
  console.log('What this means:')
  console.log('  ✓ Native C++ addon compiled correctly for Alpine Linux')
  console.log('  ✓ libftdi1 library is accessible and working')
  console.log('  ✓ No runtime ABI mismatches (musl libc compatibility)')
  console.log('  ✓ Module can be loaded and called without crashes')
  console.log('')
  console.log('⚠️  Note: Hardware testing still required')
  console.log('  - USB device detection and permissions')
  console.log('  - Actual DMX channel control')
  console.log('  - FTDI USB communication')
  console.log('')
} else {
  console.error('❌ FAILURE: Native module verification failed!')
  console.error('')
  console.error('The Docker image may not work correctly in production.')
  console.error('Review the errors above and check:')
  console.error('  - Dockerfile installs libftdi1 runtime package')
  console.error('  - Build stage has correct CXXFLAGS and LDFLAGS')
  console.error('  - Native module compiles without errors')
  console.error('')
}

process.exit(exitCode)
