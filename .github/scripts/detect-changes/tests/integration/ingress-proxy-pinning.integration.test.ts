/**
 * Integration test for the trusted-proxy contract behind issue #1555.
 *
 * Home Assistant sets `use_x_forwarded_for: true` and takes `trusted_proxies`
 * from a single `!env_var TRUSTED_PROXIES` entry. If that value does not cover
 * the address nginx reaches HA from, HA answers *every* proxied request with
 * `400 Bad Request` — no fallback, no degraded mode.
 *
 * The address nginx reaches HA from lives on the `ingress` Docker network. That
 * network used to have no `ipam` block, so Docker assigned it whatever subnet was
 * free, in creation order. A deploy recreated the networks, the assignment order
 * changed, and the hardcoded `HOMEASSISTANT_TRUSTED_PROXIES` in `.env` silently
 * stopped matching. Nothing failed loudly; the stack came up green and every
 * request through the proxy 400'd until someone happened to use it.
 *
 * These tests read the committed `docker-compose.yml` and `example.env`, so the
 * pin and the value that depends on it cannot drift apart in a commit. They are
 * static assertions: they prove the wiring is expressed correctly, not that
 * Docker honoured it. The runtime half — that the created network really carries
 * the pinned subnet — is asserted in `.github/workflows/infrastructure.yml`,
 * which brings the stack up against a live daemon.
 *
 * Beware the naming trap this bug came from: `INGRESS_SUBNET` pins the **dmz**
 * network and doubles as the WireGuard `AllowedIPs` clients route. It is NOT the
 * `ingress` network. The `ingress` network is pinned by `PROXY_BACKEND_SUBNET`.
 */

import { describe, test, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../..');
const composeFile = path.join(repoRoot, 'docker-compose.yml');
const exampleEnvFile = path.join(repoRoot, 'example.env');

interface ComposeNetwork {
  internal?: boolean;
  ipam?: { config?: Array<{ subnet?: string; ip_range?: string }> };
}

interface ComposeServiceNetworks {
  [network: string]: { ipv4_address?: string } | null;
}

interface ComposeService {
  environment?: string[];
  networks?: ComposeServiceNetworks | string[];
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
  networks?: Record<string, ComposeNetwork | null>;
}

function readCompose(): ComposeFile {
  return yaml.load(fs.readFileSync(composeFile, 'utf-8')) as ComposeFile;
}

/**
 * Parse example.env into a map, ignoring comments and blank lines.
 *
 * A Map rather than a plain object: the keys come from file content, and
 * assigning them as object properties would let a `__proto__=` line in
 * example.env reach the prototype.
 */
function readExampleEnv(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of fs.readFileSync(exampleEnvFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
  return out;
}

/**
 * The `VAR` referenced by a compose value, or null.
 *
 * Accepts `$VAR`, `${VAR}`, and the `${VAR:?message}` / `${VAR:-default}` forms.
 * The `:?` form is what the pinned values use — see the "required, not defaulted"
 * assertion below for why. Braces must balance, so `${FOO` is not a reference.
 */
function referencedVar(value: string | undefined): string | null {
  if (!value) return null;
  const bare = value.match(/^\$([A-Z0-9_]+)$/);
  if (bare) return bare[1]!;
  const braced = value.match(/^\$\{([A-Z0-9_]+)(?::[?-][^}]*)?\}$/);
  return braced ? braced[1]! : null;
}

/** True if a compose value uses the required-variable form `${VAR:?message}`. */
function isRequiredVar(value: string | undefined): boolean {
  return value !== undefined && /^\$\{[A-Z0-9_]+:\?[^}]*\}$/.test(value);
}

/** Value of `NAME=...` in a compose service's environment list. */
function envEntry(service: ComposeService, name: string): string | undefined {
  return service.environment?.find((e) => e.startsWith(`${name}=`))?.slice(name.length + 1);
}

/**
 * Expand compose variable references against example.env.
 *
 * Handles `$VAR`, `${VAR}`, `${VAR:?message}` and `${VAR:-default}`. The braced
 * forms must be consumed whole — matching only up to the variable name would
 * leave the `:?message}` tail glued to the value, which silently turns an
 * address into a non-address and makes CIDR assertions fail for the wrong reason.
 */
function expand(value: string, env: Map<string, string>): string {
  return value
    .replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_m, name: string, dflt?: string) =>
      env.get(name) !== undefined && env.get(name) !== '' ? env.get(name)! : (dflt ?? '')
    )
    .replace(/\$\{([A-Z0-9_]+):\?[^}]*\}/g, (_m, name: string) => env.get(name) ?? '')
    .replace(/\$([A-Z0-9_]+)/g, (_m, name: string) => env.get(name) ?? '');
}

/** IPv4 dotted quad to a uint32, or null if malformed. */
function toInt(addr: string): number | null {
  const parts = addr.split('.');
  if (parts.length !== 4) return null;
  let acc = 0;
  for (const part of parts) {
    // Reject '', ' 1', '0x1', '01' — Number() accepts several of these.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    acc = (acc << 8) | octet;
  }
  return acc >>> 0;
}

/** Parse `a.b.c.d/len` into a network address and mask, or null if malformed. */
function parseCidr(cidr: string): { base: number; mask: number } | null {
  const [range, bitsRaw, ...rest] = cidr.split('/');
  // A bare '10.0.0.0/' would otherwise give Number('') === 0, i.e. /0, which
  // matches every address and makes containment assertions pass vacuously.
  if (rest.length > 0 || !/^\d{1,2}$/.test(bitsRaw ?? '')) return null;
  const bits = Number(bitsRaw);
  if (bits > 32) return null;
  const base = toInt(range ?? '');
  if (base === null) return null;
  // A /0 mask would shift by 32, which is a no-op in JS. Handle it explicitly.
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (base & mask) >>> 0, mask };
}

/** Is `ip` inside `cidr`? IPv4 only — every address in this stack is IPv4. */
function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  const ipInt = toInt(ip);
  if (parsed === null || ipInt === null) return false;
  return ((ipInt & parsed.mask) >>> 0) === parsed.base;
}

/**
 * Do two CIDRs overlap at all?
 *
 * String inequality is not enough: `10.28.0.0/16` and `10.28.29.0/24` are
 * different strings and still collide, which Docker only reports at `up` time
 * on the host.
 */
function cidrsOverlap(a: string, b: string): boolean {
  const x = parseCidr(a);
  const y = parseCidr(b);
  if (x === null || y === null) return false;
  // Compare under the coarser (shorter) of the two masks: if either network
  // contains the other's base address, the ranges intersect.
  const shared = (x.mask & y.mask) >>> 0;
  return ((x.base & shared) >>> 0) === ((y.base & shared) >>> 0);
}

describe('ingress network is pinned (#1555)', () => {
  test('the ingress network declares an ipam subnet', () => {
    const networks = readCompose().networks ?? {};
    const ingress = networks['ingress'];
    const subnet = ingress?.ipam?.config?.[0]?.subnet;

    expect(subnet).toBeDefined();
  });

  test('the ingress subnet comes from a variable, not a literal', () => {
    const networks = readCompose().networks ?? {};
    const subnet = networks['ingress']?.ipam?.config?.[0]?.subnet;

    // A literal here would still pin the network, but it would put the value in
    // two places (compose and whatever trusted_proxies reads), which is the drift
    // this issue is about.
    expect(referencedVar(subnet)).not.toBeNull();
  });

  test('the ingress subnet variable is documented in example.env', () => {
    const networks = readCompose().networks ?? {};
    const varName = referencedVar(networks['ingress']?.ipam?.config?.[0]?.subnet);
    const env = readExampleEnv();

    expect(varName).not.toBeNull();
    expect(env.get(varName!)).toBeDefined();
  });

  test('the ingress subnet does not overlap the dmz subnet', () => {
    const env = readExampleEnv();
    const networks = readCompose().networks ?? {};
    const ingressVar = referencedVar(networks['ingress']?.ipam?.config?.[0]?.subnet)!;
    const dmzVar = referencedVar(networks['dmz']?.ipam?.config?.[0]?.subnet)!;

    // Assert both resolve before comparing, so this cannot pass merely because
    // the ingress pin is missing and both sides read as undefined.
    expect(env.get(ingressVar)).toBeDefined();
    expect(env.get(dmzVar)).toBeDefined();

    // Overlap, not string inequality: 10.28.0.0/16 and 10.28.29.0/24 are
    // different strings that still collide, and Docker reports that only at
    // `docker compose up` time on the host, mid-deploy.
    expect(cidrsOverlap(env.get(ingressVar)!, env.get(dmzVar)!)).toBe(false);
  });

  test('the ingress subnet does not overlap the WireGuard tunnel range', () => {
    const env = readExampleEnv();
    const networks = readCompose().networks ?? {};
    const ingressVar = referencedVar(networks['ingress']?.ipam?.config?.[0]?.subnet)!;

    // VPN_SUBNET is stored without a prefix length (the linuxserver image derives
    // the interface from it), so compare it as the /24 it actually describes.
    const vpn = `${env.get('VPN_SUBNET')}/24`;

    expect(env.get(ingressVar)).toBeDefined();
    expect(cidrsOverlap(env.get(ingressVar)!, vpn)).toBe(false);
  });
});

describe('the pinned values are required, not defaulted (#1555)', () => {
  test.each([
    ['the ingress subnet', () => readCompose().networks?.['ingress']?.ipam?.config?.[0]?.subnet],
    [
      "nginx's ingress address",
      () =>
        (readCompose().services?.['ingress']?.networks as ComposeServiceNetworks)?.['ingress']
          ?.ipv4_address,
    ],
    ["HA's TRUSTED_PROXIES", () => envEntry(readCompose().services!['ha']!, 'TRUSTED_PROXIES')],
  ])('%s uses the ${VAR:?message} form', (_label, read) => {
    // A plain `$VAR` interpolates to "" when the host's .env is missing it, and
    // compose then *silently* drops an empty ipv4_address and creates the network
    // unpinned — a green deploy that reproduces the outage. `:?` aborts at parse
    // time instead, before any container is touched.
    expect(isRequiredVar(read())).toBe(true);
  });
});

describe('nginx has a pinned address HA can trust (#1555)', () => {
  test('the ingress service pins its address on the ingress network', () => {
    const compose = readCompose();
    const nginx = compose.services?.['ingress'];
    const networks = nginx?.networks as ComposeServiceNetworks | undefined;

    expect(networks?.['ingress']?.ipv4_address).toBeDefined();
  });

  test("nginx's address variable is documented in example.env", () => {
    const compose = readCompose();
    const env = readExampleEnv();
    const nginxNetworks = compose.services?.['ingress']?.networks as ComposeServiceNetworks;
    const addressVar = referencedVar(nginxNetworks['ingress']?.ipv4_address);

    // Without this, an absent variable makes the containment and coverage
    // assertions below compare '' against '' and pass vacuously.
    expect(addressVar).not.toBeNull();
    expect(env.get(addressVar!)).toBeDefined();
    expect(env.get(addressVar!)).not.toEqual('');
  });

  test("nginx's pinned address lies inside the pinned ingress subnet", () => {
    const compose = readCompose();
    const env = readExampleEnv();
    const nginxNetworks = compose.services?.['ingress']?.networks as ComposeServiceNetworks;
    const address = expand(nginxNetworks['ingress']!.ipv4_address!, env);
    const subnetVar = referencedVar(compose.networks?.['ingress']?.ipam?.config?.[0]?.subnet)!;
    const subnet = env.get(subnetVar)!;

    // Docker refuses to start the container otherwise, but the failure lands on
    // the host mid-deploy rather than here.
    expect(ipInCidr(address, subnet)).toBe(true);
  });

  test("nginx's pinned address is outside Docker's dynamic allocation range", () => {
    const compose = readCompose();
    const env = readExampleEnv();
    const nginxNetworks = compose.services?.['ingress']?.networks as ComposeServiceNetworks;
    const address = expand(nginxNetworks['ingress']!.ipv4_address!, env);
    const rangeVar = referencedVar(compose.networks?.['ingress']?.ipam?.config?.[0]?.ip_range)!;
    const range = env.get(rangeVar)!;

    // Docker hands out dynamic addresses sequentially from ip_range. If nginx's
    // fixed address sat inside that range, a sufficiently busy network would
    // give it to another container first and nginx would fail to start with
    // "Address already in use" — at deploy time, on the host.
    expect(range).toBeDefined();
    expect(ipInCidr(address, range)).toBe(false);
    // ...but still inside the subnet, or Docker rejects it outright.
    const subnetVar = referencedVar(compose.networks?.['ingress']?.ipam?.config?.[0]?.subnet)!;
    expect(ipInCidr(address, env.get(subnetVar)!)).toBe(true);
  });
});

describe('nginx reaches HA over exactly one network (#1555)', () => {
  test('the ingress and ha services share only the ingress network', () => {
    const compose = readCompose();
    const namesOf = (svc: ComposeService): string[] =>
      Array.isArray(svc.networks) ? svc.networks : Object.keys(svc.networks ?? {});

    const nginxNets = namesOf(compose.services!['ingress']!);
    const haNets = namesOf(compose.services!['ha']!);
    const shared = nginxNets.filter((n) => haNets.includes(n));

    // config/ingressgen/templates/nginx.tmpl emits one upstream `server` line per
    // shared network. A second shared network (e.g. attaching ha to dmz) would
    // make roughly half of all requests arrive from nginx's *other* address,
    // which TRUSTED_PROXIES does not cover — intermittent 400s that none of the
    // address assertions above would catch.
    expect(shared).toEqual(['ingress']);
  });
});

describe("HA's trusted_proxies cannot drift from the proxy's address (#1555)", () => {
  test('TRUSTED_PROXIES resolves to a value that covers nginx', () => {
    const compose = readCompose();
    const env = readExampleEnv();

    const trusted = expand(envEntry(compose.services!['ha']!, 'TRUSTED_PROXIES')!, env);
    const nginxNetworks = compose.services!['ingress']!.networks as ComposeServiceNetworks;
    const nginxAddress = expand(nginxNetworks['ingress']!.ipv4_address!, env);

    // Accept either an exact address or a CIDR containing it, so tightening or
    // widening the trust scope stays a deliberate one-line choice.
    const covers = trusted.includes('/')
      ? ipInCidr(nginxAddress, trusted)
      : trusted === nginxAddress;

    expect(covers).toBe(true);
  });

  test('TRUSTED_PROXIES and the proxy address share one variable', () => {
    const compose = readCompose();
    const trustedRef = referencedVar(envEntry(compose.services!['ha']!, 'TRUSTED_PROXIES'));
    const nginxNetworks = compose.services!['ingress']!.networks as ComposeServiceNetworks;
    const addressRef = referencedVar(nginxNetworks['ingress']!.ipv4_address);

    // The previous shape had TRUSTED_PROXIES on its own variable with nothing
    // tying it to the network. Two independent values is exactly how they drift:
    // one source means correcting the address corrects the trust automatically.
    expect(trustedRef).not.toBeNull();
    expect(trustedRef).toEqual(addressRef);
  });

  test('the retired HOMEASSISTANT_TRUSTED_PROXIES variable is gone', () => {
    const env = readExampleEnv();
    const composeRaw = fs.readFileSync(composeFile, 'utf-8');

    // Leaving it defined invites someone to set it on a host and wonder why it
    // has no effect.
    expect(env.get('HOMEASSISTANT_TRUSTED_PROXIES')).toBeUndefined();
    expect(composeRaw).not.toContain('HOMEASSISTANT_TRUSTED_PROXIES');
  });
});
