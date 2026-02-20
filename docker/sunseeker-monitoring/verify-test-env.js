#!/usr/bin/env node
/**
 * Verification script for test.env configuration
 * Ensures that test.env provides all required environment variables
 * for CI healthcheck tests to pass
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse .env file manually
function parseEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      env[key.trim()] = valueParts.join('=').trim();
    }
  }

  return env;
}

// Load test.env
const testEnvPath = join(__dirname, 'test.env');
if (!fs.existsSync(testEnvPath)) {
  console.error('❌ test.env file not found');
  process.exit(1);
}

console.log('🧪 Verifying test.env configuration...');

const env = parseEnvFile(testEnvPath);

// Required fields for healthcheck
const requiredFields = [
  'MQTT_USERNAME',
  'MQTT_DEVICE_ID',
  'MQTT_APP_ID',
  'INFLUXDB_ORG',
  'INFLUXDB_BUCKET'
];

// Password/token fields - must use direct vars, not _FILE
const secretFields = [
  { direct: 'MQTT_PASSWORD', file: 'MQTT_PASSWORD_FILE' },
  { direct: 'INFLUXDB_TOKEN', file: 'INFLUXDB_TOKEN_FILE' }
];

let hasErrors = false;

// Check required fields
for (const field of requiredFields) {
  if (!env[field]) {
    console.error(`❌ Missing required field: ${field}`);
    hasErrors = true;
  } else {
    console.log(`✅ ${field}: ${env[field]}`);
  }
}

// Check secret fields - should use direct vars, not _FILE pointing to /dev/null
for (const { direct, file } of secretFields) {
  if (env[file] === '/dev/null') {
    console.error(`❌ ${file} points to /dev/null - use ${direct}=test_value instead`);
    hasErrors = true;
  } else if (env[direct]) {
    console.log(`✅ ${direct}: [SET]`);
  } else if (env[file]) {
    // Check if file exists and is readable
    try {
      const secretValue = fs.readFileSync(env[file], 'utf8').trim();
      if (!secretValue) {
        console.error(`❌ ${file} (${env[file]}) is empty`);
        hasErrors = true;
      } else {
        console.log(`✅ ${direct} (from file): [SET]`);
      }
    } catch (error) {
      console.error(`❌ Cannot read ${file}: ${env[file]} - ${error.message}`);
      hasErrors = true;
    }
  } else {
    console.error(`❌ Missing both ${direct} and ${file}`);
    hasErrors = true;
  }
}

if (hasErrors) {
  console.log('\n❌ test.env validation failed');
  process.exit(1);
} else {
  console.log('\n✅ test.env is valid for CI healthcheck tests');
  process.exit(0);
}
