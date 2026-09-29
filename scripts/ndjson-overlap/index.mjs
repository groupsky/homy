#!/usr/bin/env node
// The Node half of scripts/ndjson-overlap.sh (issue #1622): plans the checks,
// compares one stream and day, and prints the table. It never runs docker
// itself, so it also runs in the node image on a host without Node.
//
//   plan [--stream S]... [DAY...]   stdin: `docker compose config --format json`
//                                   stdout: one job (JSON) per stream and day;
//                                   DAY defaults to yesterday (UTC)
//   compare JOB                     stdin: the job's mongoScript output
//                                   stdout: one result (JSON)
//   report [--samples]              stdin: results (JSON lines)
//                                   stdout: markdown table; exit 1 unless all equal
//
// Exit status 2 means the check itself failed. See README.md.
import { compareDay, defaultDay, planJobs, renderReport } from './lib.mjs'

async function readStdin () {
  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) text += chunk
  return text
}

function parseResults (text) {
  return text.split('\n').filter((line) => line.trim() !== '').map((line, i) => {
    try {
      return JSON.parse(line)
    } catch {
      throw new Error(`result line ${i + 1} is not JSON`)
    }
  })
}

async function main (command, args) {
  if (command === 'plan') {
    const streams = []
    const days = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--stream') {
        if (args[i + 1] === undefined) throw new Error('--stream needs a stream name')
        streams.push(args[++i])
      } else if (args[i].startsWith('-')) {
        throw new Error(`unknown option ${args[i]}`)
      } else {
        days.push(args[i])
      }
    }
    const config = JSON.parse(await readStdin())
    const jobs = planJobs(config, { streams, days: days.length ? days : [defaultDay()] })
    for (const job of jobs) process.stdout.write(JSON.stringify(job) + '\n')
    return 0
  }
  if (command === 'compare') {
    if (args.length !== 1) throw new Error('compare takes one job (JSON)')
    process.stdin.setEncoding('utf8')
    const result = await compareDay({ job: JSON.parse(args[0]), mongoLines: process.stdin })
    process.stdout.write(JSON.stringify(result) + '\n')
    return 0
  }
  if (command === 'report') {
    const unknown = args.filter((a) => a !== '--samples')
    if (unknown.length) throw new Error(`unknown option ${unknown[0]}`)
    const { markdown, allEqual } = renderReport(parseResults(await readStdin()), { samples: args.includes('--samples') })
    process.stdout.write(markdown)
    return allEqual ? 0 : 1
  }
  throw new Error(`unknown command ${JSON.stringify(command)}; expected plan, compare or report`)
}

// Exit status 1 means "differ"; no failure may exit with it by accident.
process.on('uncaughtException', (err) => {
  console.error(`ndjson-overlap: ${err.message}`)
  process.exit(2)
})

try {
  process.exitCode = await main(process.argv[2], process.argv.slice(3))
} catch (err) {
  console.error(`ndjson-overlap: ${err.message}`)
  process.exitCode = 2
}
