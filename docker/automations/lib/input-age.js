/**
 * Watches how old a bot's inputs are, so a bot does not keep acting on the
 * last value of a reader that stopped (#1743).
 *
 * - `seen(key, madeAt)`: the input `key` arrived. `madeAt` is when it was made,
 *   if known (a retained message can be hours old); otherwise now.
 * - `isFresh()`: every input arrived within `maxAgeMs` since the start. State
 *   kept over a restart may be hours old, so an input not seen yet is not fresh.
 * - `isStale()`: some input is older than `maxAgeMs`. An input not seen yet
 *   counts from the start, so a fresh start is not reported at once.
 * - `onChange(stale)` is called once when the inputs go stale and once when
 *   they are back. The age is checked on every input and every 30 s.
 */
const DEFAULT_MAX_INPUT_AGE_MS = 10 * 60 * 1000
const CHECK_INTERVAL_MS = 30 * 1000

const watchInputAge = ({inputs, maxAgeMs = DEFAULT_MAX_INPUT_AGE_MS, onChange = () => {}}) => {
  const startedAt = Date.now()
  const lastSeen = new Map(inputs.map((key) => [key, null]))
  let stale = false

  const age = (key) => Date.now() - (lastSeen.get(key) ?? startedAt)
  const isStale = () => inputs.some((key) => age(key) > maxAgeMs)
  const isFresh = () => inputs.every((key) => lastSeen.get(key) != null && age(key) <= maxAgeMs)

  const check = () => {
    if (isStale() !== stale) {
      stale = !stale
      onChange(stale)
    }
  }
  setInterval(check, CHECK_INTERVAL_MS).unref?.()

  return {
    seen: (key, madeAt) => {
      lastSeen.set(key, typeof madeAt === 'number' ? madeAt : Date.now())
      check()
    },
    isFresh,
    isStale,
  }
}

module.exports = {watchInputAge, DEFAULT_MAX_INPUT_AGE_MS}
