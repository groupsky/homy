import fs from 'fs'

export function loadSecret(name) {
  const fileEnvVar = `${name}_FILE`
  const directEnvVar = name
  
  if (process.env[fileEnvVar]) {
    try {
      return fs.readFileSync(process.env[fileEnvVar], 'utf8').trim()
    } catch (error) {
      console.error(`Failed to read secret from file ${process.env[fileEnvVar]}:`, error.message)
      return null
    }
  } else if (process.env[directEnvVar]) {
    return process.env[directEnvVar]
  }
  
  return null
}

// For logs: an id shown only by its last 3 characters (issue #1765). Shorter
// ids are hidden completely.
export function maskId(id) {
  const text = String(id)
  return text.length > 3 ? `***${text.slice(-3)}` : '***'
}
