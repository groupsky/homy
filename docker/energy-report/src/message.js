// The monthly Telegram message, sent through telegram-bridge.
import { addMonths } from './time.js'
import { MAIN, NOT_METERED } from './report.js'

const SOURCE = 'energy-report'

// The names people know the meters by. The dashboard uses the same names.
const LABELS = {
  water_pump: 'Borehole pump',
  oven: 'Oven',
  stove: 'Stove',
  dishwasher: 'Dishwasher',
  laundry: 'Laundry',
  boiler: 'Hot-water element',
  heat_pump: 'Heat pump',
  microwave: 'Microwave',
  charger: 'Car charger'
}

// telegram-bridge sends with parse_mode HTML, so text must not carry raw <, > or &.
const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const kwh = (x) => x.toFixed(0)
const pct = (x) => (x === undefined ? 'n/a' : `${x.toFixed(1)} %`)
const signed = (x) => `${x > 0 ? '+' : ''}${x.toFixed(1)} %`

// The dashboard link opens the month of the message. Without a URL the
// message names the dashboard instead.
function dashboardLine (dashboardUrl, month) {
  if (!dashboardUrl) return `Dashboard: Grafana, "Energy by month", month ${month}`
  const url = new URL(dashboardUrl)
  url.searchParams.set('var-month', month)
  return `Dashboard: ${url}`
}

// A short summary of one month: main with day/night and the night share, the
// cost, the change against the same month of last year, the 3 largest loads,
// and the dashboard (a link when one is set). A line without data (no cost before the current
// prices, no last year in the first year) is left out.
export function telegramText (month, rows, dashboardUrl) {
  const main = rows.find((r) => r.meter === MAIN.name).fields
  const lines = [
    `Main meter: ${kwh(main.kwh)} kWh (day ${kwh(main.kwh_day)}, night ${kwh(main.kwh_night)}), night share ${pct(main.night_share_pct)}`
  ]
  if (main.cost_eur !== undefined) lines.push(`Cost: ${main.cost_eur.toFixed(2)} EUR`)
  if (main.change_pct !== undefined) {
    lines.push(`Against ${addMonths(month, -12)}: ${signed(main.change_pct)} (${kwh(main.kwh_last_year)} kWh)`)
  }
  const top = rows
    .filter((r) => r.meter !== MAIN.name && r.meter !== NOT_METERED)
    .sort((a, b) => b.fields.kwh - a.fields.kwh)
    .slice(0, 3)
    .map(({ meter, fields }) => `${LABELS[meter] ?? meter} ${kwh(fields.kwh)} kWh (${pct(fields.share_pct)})`)
  if (top.length > 0) lines.push(`Top loads: ${top.join(', ')}`)
  lines.push(dashboardLine(dashboardUrl, month))
  return [`<b>Energy ${month}</b>`, ...lines.map(escape)].join('\n')
}

// Best effort: a failure is logged and never thrown, so a missing message
// never stops the report.
export async function sendTelegram ({ url, fetch = globalThis.fetch, log }, text) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: SOURCE, message: text })
    })
    if (!response.ok) {
      log(`telegram-bridge refused the message: HTTP ${response.status}`)
      return false
    }
    return true
  } catch (err) {
    log(`failed to send the message: ${err.message}`)
    return false
  }
}
