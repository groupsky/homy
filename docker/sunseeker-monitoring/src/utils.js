/**
 * Utility functions for Sunseeker MQTT-InfluxDB service
 * Common validation, error handling, and helper functions
 */

import fs from 'fs';

/**
 * Load secret value from file or environment variable
 * Follows Docker secrets pattern: check ${NAME}_FILE first, then ${NAME}
 * @param {string} name - Secret name (e.g., 'MQTT_PASSWORD')
 * @returns {string|null} Secret value or null if not found
 */
export function loadSecret(name) {
  const fileEnvVar = `${name}_FILE`;
  const directEnvVar = name;
  
  if (process.env[fileEnvVar]) {
    try {
      return fs.readFileSync(process.env[fileEnvVar], 'utf8').trim();
    } catch (error) {
      console.error(`Failed to read secret from file ${process.env[fileEnvVar]}:`, error.message);
      return null;
    }
  } else if (process.env[directEnvVar]) {
    return process.env[directEnvVar];
  }
  
  return null;
}

/**
 * Validate required configuration fields and throw descriptive error if missing
 * @param {Object} config - Configuration object to validate
 * @param {Object} schema - Validation schema with required field paths
 * @throws {Error} If required fields are missing
 */
export function validateConfig(config, schema) {
  const missingFields = [];
  
  for (const [fieldPath, description] of Object.entries(schema)) {
    const value = getNestedValue(config, fieldPath);
    if (!value) {
      missingFields.push(description || fieldPath);
    }
  }
  
  if (missingFields.length > 0) {
    throw new Error(`Missing required configuration fields: ${missingFields.join(', ')}`);
  }
}

/**
 * Get nested object value using dot notation path
 * @param {Object} obj - Object to traverse
 * @param {string} path - Dot notation path (e.g., 'mqtt.password')
 * @returns {*} Value at path or undefined
 */
function getNestedValue(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

/**
 * Create a standardized error with context
 * @param {string} message - Error message
 * @param {string} context - Error context (e.g., 'MQTT_CONNECTION', 'MESSAGE_PARSING')
 * @param {Error} [originalError] - Original error that caused this
 * @returns {Error} Enhanced error with context
 */
export function createError(message, context, originalError = null) {
  const error = new Error(message);
  error.context = context;
  error.originalError = originalError;
  return error;
}

/**
 * Generate random client ID with prefix
 * @param {string} prefix - Client ID prefix
 * @returns {string} Random client ID
 */
export function generateClientId(prefix) {
  return `${prefix}${Math.random().toString(16).slice(2, 10)}`;
}

/**
 * Check if a timestamp is within the specified age limit
 * @param {number} timestamp - Timestamp to check (milliseconds)
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {boolean} True if timestamp is recent enough
 */
export function isTimestampRecent(timestamp, maxAgeMs) {
  if (!timestamp) return false;
  return (Date.now() - timestamp) < maxAgeMs;
}

/**
 * Safely parse JSON with error handling
 * @param {string} jsonString - JSON string to parse
 * @param {string} [context] - Context for error logging
 * @returns {Object|null} Parsed object or null if invalid
 */
export function safeJsonParse(jsonString, context = 'JSON parsing') {
  try {
    return JSON.parse(jsonString);
  } catch (error) {
    console.error(`Failed to parse JSON (${context}):`, error.message);
    return null;
  }
}

/**
 * Extract device ID from MQTT topic using regex
 * @param {string} topic - MQTT topic
 * @returns {string|null} Device ID or null if not found
 */
export function extractDeviceIdFromTopic(topic) {
  const deviceMatch = topic.match(/\/device\/([^\/]+)\//);
  return deviceMatch ? deviceMatch[1] : null;
}

/**
 * Redact sensitive information for logging
 * @param {string} value - Value to redact
 * @returns {string} '[REDACTED]' or '[NOT SET]'
 */
export function redactSecret(value) {
  return value ? '[REDACTED]' : '[NOT SET]';
}