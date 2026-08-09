#!/usr/bin/env node
/**
 * Validates evaluator types in provisioned Grafana alert rules.
 *
 * Grafana 9.5 `classic_conditions` only knows five evaluators (see
 * pkg/expr/classic/classic.go, newAlertEvaluator): gt, lt, within_range,
 * outside_range and no_value. Anything else - `gte` and `lte` above all, which
 * look plausible and are accepted by the YAML provisioner - makes the scheduler
 * fail with "invalid evaluator type" on every tick. The rule then never
 * evaluates its query, and with `execErrState: OK` it reports Normal, so it is
 * silently dead with no visible error anywhere in the UI.
 *
 * That happened twice: boiler-solar-circulation-stuck (`lte`, issue #1472) and
 * boiler-controller-emergency-heating (`gte`, issue #1475, dead from the day it
 * was written). This check exists so it cannot happen a third time.
 *
 * Rewrite rules: `gte N` is `gt N-1` on an integer count, `lte N` is `lt N+1`.
 *
 * No dependencies on purpose - runs as `node .github/scripts/validate-grafana-alerts.js`.
 */

const fs = require('fs')
const path = require('path')

const SUPPORTED_EVALUATORS = ['gt', 'lt', 'within_range', 'outside_range', 'no_value']
const SUGGESTIONS = {
  gte: 'use `gt` with the threshold lowered by one step (`gte 1` on a count is `gt 0`)',
  lte: 'use `lt` with the threshold raised by one step (`lte 1` on a count is `lt 2`)',
  eq: 'use `within_range` around the value',
  ne: 'use `outside_range` around the value',
}

const DEFAULT_DIR = 'config/grafana/provisioning/alerting'

/**
 * Scans one provisioning file for evaluator types.
 *
 * The file is walked line by line rather than parsed as YAML so that every
 * finding can name the exact line number, and so the check has no dependencies.
 * Both styles used in this repository are handled:
 *
 *   block: `- evaluator:` then indented `params:` / `type:` keys
 *   flow : `- evaluator: { type: lt, params: [30] }`
 *
 * For the block style, indentation is tracked to tell the evaluator's own
 * `type:` apart from the `type:` keys of the surrounding `operator:`,
 * `reducer:` and condition objects, all of which use the same key name.
 *
 * @param {string} file path to a Grafana alert provisioning YAML file
 * @returns {{found: {file: string, line: number, uid: string, type: string}[], declared: number}}
 *   findings, plus how many `evaluator:` keys the file declares (used as a
 *   self-check so a scanner miss fails the build instead of passing silently)
 */
function findEvaluatorTypes (file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const found = []
  let declared = 0
  let uid = '(no uid seen yet)'
  let evaluatorIndent = null

  lines.forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '')
    if (!line.trim()) return
    const indent = line.length - line.trimStart().length

    const uidMatch = line.match(/^\s*-?\s*uid:\s*(\S+)/)
    if (uidMatch) uid = uidMatch[1]

    if (/(^|\s)evaluator:/.test(line)) declared++

    // Leaving the block-style evaluator: any key at or left of its indentation.
    if (evaluatorIndent !== null && indent <= evaluatorIndent) evaluatorIndent = null

    const flowMatch = line.match(/(?:^|\s)evaluator:\s*\{([^}]*)\}/)
    if (flowMatch) {
      const typeMatch = flowMatch[1].match(/(?:^|[,{\s])type:\s*["']?([A-Za-z_]+)["']?/)
      if (typeMatch) found.push({ file, line: i + 1, uid, type: typeMatch[1] })
      return
    }

    if (/^\s*(?:-\s+)?evaluator:\s*$/.test(line)) {
      evaluatorIndent = line.indexOf('evaluator:')
      return
    }

    if (evaluatorIndent === null) return
    const typeMatch = line.match(/^\s*type:\s*["']?([A-Za-z_]+)["']?\s*$/)
    if (typeMatch) found.push({ file, line: i + 1, uid, type: typeMatch[1] })
  })

  return { found, declared }
}

function main () {
  const dir = process.argv[2] || DEFAULT_DIR

  if (!fs.existsSync(dir)) {
    console.error(`❌ Alert provisioning directory not found: ${dir}`)
    process.exit(1)
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort()
    .map((f) => path.join(dir, f))

  if (files.length === 0) {
    console.error(`❌ No alert provisioning files found in ${dir}`)
    process.exit(1)
  }

  console.log(`🔍 Checking evaluator types in ${files.length} file(s) under ${dir}`)
  console.log(`   Supported by Grafana 9.5 classic_conditions: ${SUPPORTED_EVALUATORS.join(', ')}`)
  console.log('')

  const evaluators = []
  const unreadable = []

  for (const file of files) {
    const { found, declared } = findEvaluatorTypes(file)
    evaluators.push(...found)
    if (found.length !== declared) unreadable.push({ file, found: found.length, declared })
  }

  const bad = evaluators.filter((e) => !SUPPORTED_EVALUATORS.includes(e.type))

  for (const file of files) {
    const n = evaluators.filter((e) => e.file === file).length
    const b = bad.filter((e) => e.file === file).length
    console.log(`  ${b === 0 ? '✅' : '❌'} ${file} - ${n} evaluator(s)${b ? `, ${b} invalid` : ''}`)
  }
  console.log('')

  // Fail closed: an evaluator this scanner cannot read is an unchecked evaluator.
  if (unreadable.length > 0) {
    console.error('❌ Some evaluators could not be read - they are therefore unchecked.')
    for (const u of unreadable) {
      console.error(`  ${u.file}: declares ${u.declared} evaluator(s), only ${u.found} type(s) resolved`)
    }
    console.error('')
    console.error('Use one of the styles this check understands:')
    console.error('  - evaluator:')
    console.error('      params: [0]')
    console.error('      type: gt')
    console.error('  - evaluator: { type: gt, params: [0] }')
    process.exit(1)
  }

  if (bad.length === 0) {
    console.log(`✅ All ${evaluators.length} evaluators use a supported type.`)
    return
  }

  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.error(`❌ ${bad.length} unsupported evaluator type(s) found.`)
  console.error('')
  for (const e of bad) {
    console.error(`  ${e.file}:${e.line}`)
    console.error(`    rule uid : ${e.uid}`)
    console.error(`    evaluator: type: ${e.type}   <-- not supported`)
    if (SUGGESTIONS[e.type]) console.error(`    fix      : ${SUGGESTIONS[e.type]}`)
    console.error('')
  }
  console.error('Grafana 9.5 classic_conditions supports only:')
  console.error(`  ${SUPPORTED_EVALUATORS.join(', ')}`)
  console.error('')
  console.error('An unsupported type does NOT fail provisioning. The rule is created,')
  console.error('looks healthy in the UI, and then fails to build an evaluator on every')
  console.error('scheduling tick ("Failed to build rule evaluator"), so it never')
  console.error('evaluates its query. With execErrState: OK it reports Normal and')
  console.error('nothing ever pages. See issues #1472 and #1475.')
  console.error('')
  console.error('See config/grafana/CLAUDE.md, "Supported classic_conditions evaluators".')
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  process.exit(1)
}

main()
