# Power dips: input module glitches and relay board restarts

The `dry-switches` input modules (`mbsl32di1`, `mbsl32di2`) and relay boards
(`relays00-15`, `relays16-31`) are on a 12 V supply that is not on the UPS.
In a short mains cut they restart while `routy` keeps running (#1956).

## Input module glitch: a partial reading, then all inputs read 0

While an input module restarts, it reads `inputs: 0` for a few seconds. Then
the real value comes back. In 3 of 7 recorded dips the module first sent a
**partial reading**: many inputs dropped at once, but not all, 23-37 ms
before the 0 (#2007). Both modules always take part.

### First guard: the Modbus reader

The dry-switches reader holds these readings back, so no consumer
(automations, the window bots, `dmx-driver`, InfluxDB) sees them. The code
is `docker/modbus-serial/power-dip-guard.js`; the config is `powerDipGuard`
in `config/modbus-serial/dry-switches.js`. Without that config the reader
publishes every reading at once, as before.

- **Dip start**, on either input module: a reading of 0, or `minChangedBits`
  (3) or more inputs changed against the last published value.
- **Hold:** any other change is published after the next good read of each
  input module shows no dip start: one poll pass, about 30 ms. A failed read
  makes the hold go on. Once the change's own module read again with no dip
  start, a module that does not answer holds it up for at most `stableMs`.
  The change keeps its own `_tz`.
- **During a dip** nothing is published for either module. Consumers keep
  the last good value.
- **Dip end**, per module: the reading equals the value from before the dip
  (all 7 recorded dips), or a non-zero reading has not changed for
  `stableMs` (1000 ms). A reading of 0, or a module that does not answer,
  never ends a dip. At the end the reading is published; an input that
  differs from before the dip (a switch moved during the dip) is a late
  change.
- A real change of 3 or more inputs at once (a palm on a 3-gang plate) is
  taken as a dip and is published after `stableMs`: late, not lost. If the
  inputs go back to the value from before within that time (3 buttons
  pressed and let go together), the press is not published.
- **Dip event** on `/modbus/dry-switches/power-dip/reading`:
  `{state: 'start' | 'end', _tz, durationMs, readings}`, with up to 20 held
  raw readings. mqtt-influx stores it in measurement `power_dip`. The held
  readings of a dip are not in the raw archives (MongoDB, NDJSON files) or in
  `dry_switch_input`: the dip event is the only record of them.
- A module that does not answer at all (unplugged) delays each change of the
  other module by `stableMs` (1 s).
- **Log lines:** `power dip start on <module>: ...` and
  `power dip end after <N> ms: ...`, with the module values. While a dip
  lasts, `power dip still on after <N> ms, waiting for <modules>` every
  5 minutes.

Tests: `docker/modbus-serial/power-dip.test.js` runs the real reader with
the deployed config on a fake bus and clock, and replays three recorded dips.

### Second guard: the features

- Every dry-switch feature in `config/automations/features.js` (switches,
  buttons, locks, door and window contacts) drops a reading of all 0 when the
  last good reading had 2 or more inputs set
  (`funcs/inputs_not_all_zero.js`, the `filterInput` of `drySwitch()`).
- This guard stays as a second guard behind the reader's.
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
