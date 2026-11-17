# Power dips: input module glitches and relay board restarts

The `dry-switches` input modules (`mbsl32di1`, `mbsl32di2`) and relay boards
(`relays00-15`, `relays16-31`) are on a 12 V supply that is not on the UPS.
In a short mains cut they restart while `routy` keeps running (#1956).

## Input module glitch: all inputs read 0

While an input module restarts, it reads `inputs: 0` for a few seconds. Then
the real value comes back.

- Every dry-switch feature in `config/automations/features.js` (switches,
  buttons, locks, door and window contacts) drops a reading of all 0 when the
  last good reading had 2 or more inputs set
  (`funcs/inputs_not_all_zero.js`, the `filterInput` of `drySwitch()`).
- So no switch looks toggled and no door or window looks open. The last good
  value stays published. When the real reading comes back, only bits that
  really changed count.
- A 0 after a reading with one input set is a real change (for example a
  button released while every other input is open) and passes. Several
  inputs that really open at the very same poll are not seen until the next
  change on that module; this is not expected to happen.
- A single switch or contact change is not delayed.
- Bots that read the raw module topic themselves (`bac002-toggle-power`
  window contacts in `config/automations/config.js`) do not use this filter.
  They wait 30 s before acting (#1797).

## Relay board restart: a write times out

A restarting relay board does not answer, so a write to it fails. The board
reports its outputs only on change, after a successful write, or every 7 to
11 minutes, so no status follows the failed write.

- A toggle (`features/state.js`, used by `feature-toggle-on-feature-change`)
  computes from the last command until a status comes after it. It does not
  compute from the older status, so it never writes the same value twice.
- When a status comes, it wins over the command.
- Before the fix, a dip toggled each light twice: the first write ("on")
  failed, the second toggle computed "on" again from the old "off" state and
  worked. Four lights switched on with nobody at a switch.

Tests: `power-dip.test.js` (a replay of the 2026-11-16 dip with the deployed
config) and `features/state.test.js`.
