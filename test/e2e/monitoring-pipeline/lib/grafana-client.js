/**
 * Grafana client utilities for E2E testing
 * Provides functions to interact with Grafana API and test dashboard functionality
 */

/**
 * Test Grafana health endpoint
 * @param {string} grafanaUrl - Grafana base URL
 * @returns {Promise<boolean>} True if healthy
 */
export async function checkGrafanaHealth(grafanaUrl = 'http://localhost:3000') {
  console.log(`Checking Grafana health at ${grafanaUrl}...`)
  
  try {
    const response = await fetch(`${grafanaUrl}/api/health`)
    const isHealthy = response.ok
    
    if (isHealthy) {
      console.log('Grafana is healthy')
    } else {
      console.log(`Grafana health check failed: ${response.status}`)
    }
    
    return isHealthy
  } catch (error) {
    console.log(`Grafana health check error: ${error.message}`)
    return false
  }
}

/**
 * Test Grafana data source connectivity
 * @param {string} grafanaUrl - Grafana base URL
 * @param {string} username - Admin username
 * @param {string} password - Admin password
 * @returns {Promise<Array>} Array of data sources
 */
export async function testDataSources(grafanaUrl = 'http://localhost:3000', username = 'admin', password = 'admin') {
  console.log('Testing Grafana data sources...')
  
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  
  try {
    const response = await fetch(`${grafanaUrl}/api/datasources`, {
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/json'
      }
    })
    
    if (!response.ok) {
      throw new Error(`Data sources API error: ${response.status}`)
    }
    
    const dataSources = await response.json()
    console.log(`Found ${dataSources.length} data sources`)
    
    // Test each data source
    for (const ds of dataSources) {
      if (ds.type === 'influxdb') {
        console.log(`Testing InfluxDB data source: ${ds.name}`)
        await testDataSourceConnection(grafanaUrl, ds.id, auth)
      }
    }
    
    return dataSources
  } catch (error) {
    console.error('Data sources test failed:', error.message)
    throw error
  }
}

/**
 * Test specific data source connection
 * @param {string} grafanaUrl - Grafana base URL
 * @param {number} dataSourceId - Data source ID
 * @param {string} auth - Authorization header value
 */
async function testDataSourceConnection(grafanaUrl, dataSourceId, auth) {
  try {
    const response = await fetch(`${grafanaUrl}/api/datasources/${dataSourceId}/proxy/query`, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'q=SHOW DATABASES'
    })
    
    if (response.ok) {
      console.log(`Data source ${dataSourceId} connection: OK`)
    } else {
      console.log(`Data source ${dataSourceId} connection failed: ${response.status}`)
    }
  } catch (error) {
    console.log(`Data source ${dataSourceId} connection error: ${error.message}`)
  }
}

/**
 * Execute a test query against InfluxDB via Grafana proxy
 * @param {string} grafanaUrl - Grafana base URL
 * @param {string} query - InfluxDB query
 * @param {string} username - Admin username
 * @param {string} password - Admin password
 * @returns {Promise<Object>} Query result
 */
export async function executeTestQuery(grafanaUrl = 'http://localhost:3000', query, username = 'admin', password = 'admin') {
  console.log(`Executing test query via Grafana: ${query}`)
  
  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')
  
  try {
    // Get data sources to find InfluxDB
    const dsResponse = await fetch(`${grafanaUrl}/api/datasources`, {
      headers: { 'Authorization': auth }
    })
    
    if (!dsResponse.ok) {
      throw new Error(`Failed to get data sources: ${dsResponse.status}`)
    }
    
    const dataSources = await dsResponse.json()
    const influxDS = dataSources.find(ds => ds.type === 'influxdb')
    
    if (!influxDS) {
      throw new Error('InfluxDB data source not found')
    }
    
    // Execute query via proxy
    const queryResponse = await fetch(`${grafanaUrl}/api/datasources/${influxDS.id}/proxy/query`, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: `q=${encodeURIComponent(query)}&db=${process.env.INFLUXDB_DATABASE || 'automation'}`
    })
    
    if (!queryResponse.ok) {
      throw new Error(`Query execution failed: ${queryResponse.status}`)
    }
    
    const result = await queryResponse.json()
    console.log(`Query executed successfully, got ${result.results?.[0]?.series?.length || 0} series`)
    
    return result
  } catch (error) {
    console.error('Test query failed:', error.message)
    throw error
  }
}

/**
 * Validate that Grafana can query the command_failure measurement
 * @param {string} grafanaUrl - Grafana base URL
 * @param {string} username - Admin username
 * @param {string} password - Admin password
 * @returns {Promise<Object>} Validation results
 */
export async function validateGrafanaQueries(grafanaUrl = 'http://localhost:3000', username = 'admin', password = 'admin') {
  console.log('Validating Grafana queries for monitoring dashboard...')
  
  const validation = {
    success: true,
    errors: [],
    queries: []
  }
  
  // Test queries that match our Grafana dashboard
  const testQueries = [
    {
      name: 'command_failure_count',
      query: 'SELECT count(*) FROM "command_failure" WHERE time > now() - 1h'
    },
    {
      name: 'command_failure_by_controller',
      query: 'SELECT count(*) FROM "command_failure" WHERE time > now() - 1h GROUP BY "controller"'
    },
    {
      name: 'command_failure_by_reason',
      query: 'SELECT count(*) FROM "command_failure" WHERE time > now() - 1h GROUP BY "reason"'
    }
  ]
  
  for (const testQuery of testQueries) {
    try {
      console.log(`Testing query: ${testQuery.name}`)
      const result = await executeTestQuery(grafanaUrl, testQuery.query, username, password)
      
      validation.queries.push({
        name: testQuery.name,
        success: true,
        result: result
      })
      
      console.log(`Query ${testQuery.name}: PASS`)
    } catch (error) {
      validation.success = false
      validation.errors.push(`Query ${testQuery.name} failed: ${error.message}`)
      
      validation.queries.push({
        name: testQuery.name,
        success: false,
        error: error.message
      })
      
      console.log(`Query ${testQuery.name}: FAIL - ${error.message}`)
    }
  }
  
  console.log(`Grafana query validation: ${validation.success ? 'PASS' : 'FAIL'}`)
  return validation
}

/**
 * Wait for Grafana to be ready and accepting connections
 * @param {string} grafanaUrl - Grafana URL
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} True if ready, throws on timeout
 */
export async function waitForGrafana(grafanaUrl = 'http://localhost:3000', timeoutMs = 60000) {
  console.log(`Waiting for Grafana to be ready at ${grafanaUrl}...`)
  
  const startTime = Date.now()
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      const isHealthy = await checkGrafanaHealth(grafanaUrl)
      if (isHealthy) {
        console.log('Grafana is ready')
        return true
      }
    } catch (error) {
      // Expected while service is starting up
    }
    
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  
  throw new Error(`Grafana not ready after ${timeoutMs}ms`)
}