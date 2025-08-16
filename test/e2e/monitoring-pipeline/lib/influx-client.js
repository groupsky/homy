/**
 * InfluxDB client utilities for E2E testing
 * Provides functions to query InfluxDB data and validate storage
 */

import { InfluxDB } from '@influxdata/influxdb-client'

/**
 * Query InfluxDB for command failure events using InfluxQL (v1.8 compatible)
 * @param {string} influxUrl - InfluxDB URL
 * @param {string} measurement - Measurement name to query
 * @param {number} timeRangeMinutes - Time range in minutes to look back
 * @returns {Promise<Array>} Array of data points
 */
export async function queryCommandFailures(influxUrl, measurement = 'command_failure', timeRangeMinutes = 10) {
  console.log(`Querying InfluxDB for ${measurement} events in last ${timeRangeMinutes} minutes...`)
  
  const database = process.env.INFLUXDB_DATABASE || 'homy'
  const query = `SELECT * FROM "${measurement}" WHERE time > now() - ${timeRangeMinutes}m ORDER BY time DESC`
  
  const url = `${influxUrl}/query?db=${database}&q=${encodeURIComponent(query)}`
  
  try {
    // Use test credentials for InfluxDB auth (reader/secret)
    const auth = Buffer.from('reader:secret').toString('base64')
    const response = await fetch(url, {
      headers: {
        'Authorization': `Basic ${auth}`
      }
    })
    
    if (!response.ok) {
      throw new Error(`InfluxDB query failed: ${response.status} ${response.statusText}`)
    }
    
    const result = await response.json()
    
    if (result.error) {
      throw new Error(`InfluxDB query error: ${result.error}`)
    }
    
    // Parse InfluxQL response format
    const data = []
    if (result.results && result.results[0] && result.results[0].series) {
      const series = result.results[0].series[0]
      if (series && series.values) {
        const columns = series.columns
        
        series.values.forEach(row => {
          const record = {}
          columns.forEach((column, index) => {
            record[column] = row[index]
          })
          data.push(record)
        })
      }
    }
    
    console.log(`Found ${data.length} records in InfluxDB`)
    return data
    
  } catch (error) {
    console.error('InfluxDB query error:', error)
    throw error
  }
}

/**
 * Verify that InfluxDB contains expected failure events
 * @param {Array} events - Events that were published
 * @param {Array} influxData - Data retrieved from InfluxDB
 * @returns {Object} Validation results
 */
export function validateFailureEvents(events, influxData) {
  const validation = {
    success: true,
    errors: [],
    found: influxData.length,
    expected: events.length
  }
  
  console.log(`Validating ${events.length} expected events against ${influxData.length} found events`)
  
  // Check if we have any data at all
  if (influxData.length === 0) {
    validation.success = false
    validation.errors.push('No failure events found in InfluxDB')
    return validation
  }
  
  // Group InfluxDB data by controller and reason for easier lookup
  const influxByKey = {}
  influxData.forEach(record => {
    const key = `${record.controller}-${record.reason}`
    if (!influxByKey[key]) {
      influxByKey[key] = []
    }
    influxByKey[key].push(record)
  })
  
  // Validate each expected event
  events.forEach(event => {
    const key = `${event.controller}-${event.reason}`
    const matchingRecords = influxByKey[key] || []
    
    if (matchingRecords.length === 0) {
      validation.success = false
      validation.errors.push(`Expected event not found: ${key}`)
    } else {
      // Validate event structure
      const record = matchingRecords[0]
      
      if (record.attempts !== event.attempts) {
        validation.errors.push(`Attempts mismatch for ${key}: expected ${event.attempts}, got ${record.attempts}`)
      }
      
      if (record.expected_state !== event.expectedState) {
        validation.errors.push(`Expected state mismatch for ${key}: expected ${event.expectedState}, got ${record.expected_state}`)
      }
      
      if (record.actual_state !== event.actualState) {
        validation.errors.push(`Actual state mismatch for ${key}: expected ${event.actualState}, got ${record.actual_state}`)
      }
    }
  })
  
  if (validation.errors.length > 0) {
    validation.success = false
  }
  
  console.log(`Validation result: ${validation.success ? 'PASS' : 'FAIL'}`)
  if (!validation.success) {
    console.log('Validation errors:', validation.errors)
  }
  
  return validation
}

/**
 * Create InfluxDB client
 * @param {string} url - InfluxDB URL
 * @param {string} token - InfluxDB token (for InfluxDB 2.x)
 * @returns {InfluxDB} InfluxDB client instance
 */
export function createInfluxClient(url = 'http://localhost:8086', token = null) {
  console.log(`Creating InfluxDB client for: ${url}`)
  
  // For InfluxDB 1.x (which seems to be used in this setup)
  // We'll use basic auth instead of token
  const client = new InfluxDB({ 
    url,
    // If token is provided, use it; otherwise use empty string for InfluxDB 1.x
    token: token || ''
  })
  
  return client
}

/**
 * Wait for InfluxDB to be ready and accepting connections
 * @param {string} url - InfluxDB URL
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} True if ready, throws on timeout
 */
export async function waitForInfluxDB(url = 'http://localhost:8086', timeoutMs = 30000) {
  console.log(`Waiting for InfluxDB to be ready at ${url}...`)
  
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`${url}/ping`)
      if (response.ok) {
        console.log('InfluxDB is ready')
        return true
      }
    } catch (error) {
      // Expected while service is starting up
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  throw new Error(`InfluxDB not ready after ${timeoutMs}ms`)
}