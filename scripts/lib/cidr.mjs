// IPv4 CIDR helpers shared by the subnet checks: the CI test for the pinned
// ingress network (.github/scripts/detect-changes) and the host pre-flight
// scripts/check-subnets.sh. Plain ESM with no dependencies, so it runs on the
// host's Node or in the node image alike. IPv4 only: every address in this
// stack is IPv4.

/** IPv4 dotted quad to a uint32, or null if malformed. */
export function toInt (addr) {
  const parts = addr.split('.')
  if (parts.length !== 4) return null
  let acc = 0
  for (const part of parts) {
    // Reject '', ' 1', '0x1': Number() accepts these.
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    acc = (acc << 8) | octet
  }
  return acc >>> 0
}

/** Parse `a.b.c.d/len` into a network address and mask, or null if malformed. */
export function parseCidr (cidr) {
  const [range, bitsRaw, ...rest] = cidr.split('/')
  // A bare '10.0.0.0/' would otherwise give Number('') === 0, i.e. /0, which
  // matches every address and makes containment checks pass vacuously.
  if (rest.length > 0 || !/^\d{1,2}$/.test(bitsRaw ?? '')) return null
  const bits = Number(bitsRaw)
  if (bits > 32) return null
  const base = toInt(range ?? '')
  if (base === null) return null
  // A /0 mask would shift by 32, which is a no-op in JS. Handle it explicitly.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return { base: (base & mask) >>> 0, mask }
}

/** Is `ip` inside `cidr`? False when either is malformed. */
export function ipInCidr (ip, cidr) {
  const parsed = parseCidr(cidr)
  const ipInt = toInt(ip)
  if (parsed === null || ipInt === null) return false
  return ((ipInt & parsed.mask) >>> 0) === parsed.base
}

/**
 * Do two CIDRs overlap at all? False when either is malformed.
 *
 * String inequality is not enough: `10.28.0.0/16` and `10.28.29.0/24` are
 * different strings and still collide, which Docker only reports at
 * `docker compose up` time on the host.
 */
export function cidrsOverlap (a, b) {
  const x = parseCidr(a)
  const y = parseCidr(b)
  if (x === null || y === null) return false
  // Compare under the coarser (shorter) of the two masks: if either network
  // contains the other's base address, the ranges intersect.
  const shared = (x.mask & y.mask) >>> 0
  return ((x.base & shared) >>> 0) === ((y.base & shared) >>> 0)
}
