// No service may end up with an unnamed Docker volume.
//
// An image that declares `VOLUME /x` gets an anonymous volume at /x unless the
// service mounts something at exactly /x. `up -d` keeps such a volume, but
// `down` drops it, so a database would silently start empty. This checks the
// resolved compose config against the VOLUMEs of every image it uses.
// Needs docker (compose v2) and access to pull the images.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (args) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

const config = JSON.parse(run(['compose', '--env-file', 'example.env', 'config', '--format', 'json']))

const imageVolumes = new Map()
function volumesOf (image) {
  if (!imageVolumes.has(image)) {
    let out
    try {
      out = run(['image', 'inspect', image, '--format', '{{json .Config.Volumes}}'])
    } catch {
      run(['pull', '--quiet', image])
      out = run(['image', 'inspect', image, '--format', '{{json .Config.Volumes}}'])
    }
    imageVolumes.set(image, Object.keys(JSON.parse(out) ?? {}))
  }
  return imageVolumes.get(image)
}

test('every VOLUME an image declares is bind-mounted by the service', () => {
  const problems = []
  for (const [name, service] of Object.entries(config.services)) {
    if (!service.image) continue
    const mounts = new Map((service.volumes ?? []).map((v) => [v.target, v]))
    for (const path of volumesOf(service.image)) {
      const mount = mounts.get(path)
      if (!mount) problems.push(`${name}: image volume ${path} has no mount, so docker makes an unnamed volume`)
      else if (mount.type !== 'bind' && mount.type !== 'tmpfs') problems.push(`${name}: ${path} is a ${mount.type} mount, not a host directory`)
    }
  }
  assert.deepEqual(problems, [])
})

test('the services holding state mount their data from the host', () => {
  const targets = (name) => (config.services[name].volumes ?? []).filter((v) => v.type === 'bind').map((v) => v.target)
  assert.ok(targets('mongo').includes('/data/db'))
  assert.ok(targets('mongo').includes('/data/configdb'))
  assert.ok(targets('broker').includes('/mosquitto/data'))
  assert.ok(targets('broker').includes('/mosquitto/log'))
})
