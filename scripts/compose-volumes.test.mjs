// No service may end up with an unnamed Docker volume.
//
// An image that declares `VOLUME /x` gets an anonymous volume at /x unless the
// service mounts something at exactly /x. `up -d` keeps such a volume, but
// `down` drops it, so a database would silently start empty. This checks the
// resolved compose config against the VOLUMEs of every image it uses.
// Needs docker (compose v2) and access to pull the images; one not published
// yet is built from its build context.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const run = (args) => execFileSync('docker', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

const config = JSON.parse(run(['compose', '--env-file', 'example.env', 'config', '--format', 'json']))

const volumesIn = (ref) => Object.keys(JSON.parse(run(['image', 'inspect', ref, '--format', '{{json .Config.Volumes}}'])) ?? {})

// An image not published yet (a service added in this change) cannot be
// pulled, so it is built from the service's build context instead. The build
// gets a throwaway tag that is removed again, so it never replaces a real
// local image of that name.
function volumesOfBuild (image, build) {
  const tag = `homy-compose-volumes-test/${image.replace(/^.*\//, '').replace(/[^a-z0-9._-]/g, '-')}:throwaway`
  run(['build', '--quiet', '--tag', tag, ...(build.dockerfile ? ['--file', resolve(build.context, build.dockerfile)] : []), build.context])
  try {
    return volumesIn(tag)
  } finally {
    run(['image', 'rm', tag])
  }
}

const imageVolumes = new Map()
function volumesOf (image, build) {
  if (!imageVolumes.has(image)) {
    let volumes
    try {
      volumes = volumesIn(image)
    } catch {
      try {
        run(['pull', '--quiet', image])
        volumes = volumesIn(image)
      } catch (err) {
        if (!build?.context) throw err
        volumes = volumesOfBuild(image, build)
      }
    }
    imageVolumes.set(image, volumes)
  }
  return imageVolumes.get(image)
}

test('every VOLUME an image declares is bind-mounted by the service', () => {
  const problems = []
  for (const [name, service] of Object.entries(config.services)) {
    if (!service.image) continue
    const mounts = new Map((service.volumes ?? []).map((v) => [v.target, v]))
    for (const path of volumesOf(service.image, service.build)) {
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

// Every modbus-serial and mqtt-ndjson service appends raw readings to daily
// files under RAW_DIR (#1622); without a host mount they would land inside the
// container and be lost with it.
test('every raw-reading writer mounts its RAW_DIR from the host', () => {
  const writers = Object.entries(config.services)
    .filter(([, service]) => /\/(modbus-serial|mqtt-ndjson):/.test(service.image ?? ''))
  assert.ok(writers.length > 0)
  const problems = []
  for (const [name, service] of writers) {
    const dir = service.environment?.RAW_DIR
    const mount = (service.volumes ?? []).find((v) => v.target === dir)
    if (!dir) problems.push(`${name}: no RAW_DIR`)
    else if (!mount || mount.type !== 'bind') problems.push(`${name}: RAW_DIR ${dir} is not bind-mounted`)
    if (!service.environment?.SERVICE_NAME) problems.push(`${name}: no SERVICE_NAME`)
    else if (service.environment.SERVICE_NAME !== name) problems.push(`${name}: SERVICE_NAME is ${service.environment.SERVICE_NAME}`)
  }
  assert.deepEqual(problems, [])
})
