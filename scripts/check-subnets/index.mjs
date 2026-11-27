// CLI for scripts/check-subnets.sh. Arguments: three files (the resolved
// compose config as JSON, `docker network inspect` output as a JSON array,
// `ip -4 route show` text). Prints each conflict on its own line to stderr;
// exit 0 when there is none, 1 when there are conflicts, 2 on bad input.
import { readFileSync } from 'node:fs'
import { findConflicts, parseRoutes } from './lib.mjs'

try {
  const [composeFile, networksFile, routesFile] = process.argv.slice(2)
  if (!routesFile) throw new Error('usage: index.mjs COMPOSE_JSON NETWORKS_JSON ROUTES_TXT')
  const compose = JSON.parse(readFileSync(composeFile, 'utf8'))
  const networksText = readFileSync(networksFile, 'utf8').trim()
  const networks = networksText === '' ? [] : JSON.parse(networksText)
  const routes = parseRoutes(readFileSync(routesFile, 'utf8'))
  const problems = findConflicts({ compose, networks, routes })
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(problems.length === 0 ? 0 : 1)
} catch (err) {
  console.error(`check-subnets: ${err.message}`)
  process.exit(2)
}
