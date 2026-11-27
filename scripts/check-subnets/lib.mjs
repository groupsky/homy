// The checks behind scripts/check-subnets.sh (#1559): do the subnets this
// repo pins collide with what the HOST already has? The inputs are plain data
// (the resolved compose config, `docker network inspect` objects, the output
// of `ip route`), so the same checks run in tests and on the host.

import { cidrsOverlap, parseCidr } from '../lib/cidr.mjs'

// Docker's own bridges. Their routes are the Docker networks, which the
// network list already covers (and the network being recreated must not
// count against itself).
const DOCKER_BRIDGE = /^(docker0|br-[0-9a-f]+)$/

/**
 * The subnets the compose file pins, as `{ what, name, cidr }`. `name` is the
 * Docker network's name (null for what is not a Docker network).
 * The WireGuard range is not a compose network but is routed to clients, so a
 * network inside it would break the VPN; it is given without a prefix length
 * and is a /24 (see example.env).
 */
export function wantedSubnets (compose) {
  const out = []
  for (const [key, network] of Object.entries(compose.networks ?? {})) {
    const name = network?.name ?? `${compose.name}_${key}`
    for (const conf of network?.ipam?.config ?? []) {
      if (conf.subnet === undefined) continue
      out.push({ what: `network ${name}`, name, cidr: conf.subnet })
    }
  }
  for (const service of Object.values(compose.services ?? {})) {
    const env = service.environment
    const vpn = Array.isArray(env)
      ? env.find((e) => e.startsWith('INTERNAL_SUBNET='))?.slice('INTERNAL_SUBNET='.length)
      : env?.INTERNAL_SUBNET
    if (vpn) out.push({ what: 'the WireGuard range', name: null, cidr: `${vpn}/24` })
  }
  return out
}

/** Routes from `ip -4 route show`: `{ cidr, dev }` for each destination. */
export function parseRoutes (text) {
  const routes = []
  for (const line of text.split('\n')) {
    const words = line.trim().split(/\s+/)
    const dest = words[0]
    if (!/^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(dest ?? '')) continue // default, broadcast, local...
    const dev = words[words.indexOf('dev') + 1] ?? ''
    routes.push({ cidr: dest.includes('/') ? dest : `${dest}/32`, dev })
  }
  return routes
}

/**
 * Human-readable conflicts; an empty list means the host is safe to create the
 * pinned networks on.
 */
export function findConflicts ({ compose, networks, routes }) {
  const wanted = wantedSubnets(compose)
  const problems = []
  const valid = []
  for (const w of wanted) {
    if (parseCidr(w.cidr) === null) {
      problems.push(`${w.what}: '${w.cidr}' is not a valid IPv4 CIDR (is a variable in .env empty or missing a /prefix?)`)
    } else {
      valid.push(w)
    }
  }
  valid.forEach((w, i) => {
    for (const other of valid.slice(i + 1)) {
      if (cidrsOverlap(w.cidr, other.cidr)) {
        problems.push(`${w.what} (${w.cidr}) overlaps ${other.what} (${other.cidr})`)
      }
    }
    for (const existing of networks) {
      if (w.name !== null && existing.Name === w.name) continue // it is the one being recreated
      for (const conf of existing.IPAM?.Config ?? []) {
        if (conf.Subnet && cidrsOverlap(w.cidr, conf.Subnet)) {
          problems.push(`${w.what} (${w.cidr}) overlaps the existing Docker network ${existing.Name} (${conf.Subnet})`)
        }
      }
    }
    for (const route of routes) {
      if (DOCKER_BRIDGE.test(route.dev)) continue
      if (cidrsOverlap(w.cidr, route.cidr)) {
        problems.push(`${w.what} (${w.cidr}) overlaps the host route ${route.cidr} (dev ${route.dev})`)
      }
    }
  })
  return problems
}
