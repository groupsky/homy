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