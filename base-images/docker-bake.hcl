# Base images build configuration
#
# Tags are set dynamically by GitHub Actions workflow based on versions
# extracted from each Dockerfile. This ensures tags always match the
# actual upstream image version without manual updates.
#
# Dependabot updates Dockerfiles → CI extracts versions → Tags applied automatically

group "default" {
  targets = [
    "node-18-alpine",
    "node-22-alpine",
    "node-ubuntu",
    "grafana",
    "influxdb",
    "mosquitto",
    "mongo",
    "nodered",
    "telegraf",
    "alpine",
    "nginx",
    "ubuntu",
    "dockergen",
    "wireguard",
    "mongo-express"
  ]
}

target "node-18-alpine" {
  context = "./node-18-alpine"
  # Tags set via workflow: ghcr.io/groupsky/homy/node:${VERSION}
}

target "node-22-alpine" {
  context = "./node-22-alpine"
  # Tags set via workflow: ghcr.io/groupsky/homy/node:${VERSION}
}

target "grafana" {
  context = "./grafana"
  # Tags set via workflow: ghcr.io/groupsky/homy/grafana:${VERSION}
}

target "influxdb" {
  context = "./influxdb"
  # Tags set via workflow: ghcr.io/groupsky/homy/influxdb:${VERSION}
}

target "mosquitto" {
  context = "./mosquitto"
  # Tags set via workflow: ghcr.io/groupsky/homy/mosquitto:${VERSION}
}

target "mongo" {
  context = "./mongo"
  # Tags set via workflow: ghcr.io/groupsky/homy/mongo:${VERSION}
}

target "telegraf" {
  context = "./telegraf"
  # Tags set via workflow: ghcr.io/groupsky/homy/telegraf:${VERSION}
}

target "node-ubuntu" {
  context = "./node-ubuntu"
  # Tags set via workflow: ghcr.io/groupsky/homy/node-ubuntu:${VERSION}
}

target "nodered" {
  context = "./nodered"
  # Tags set via workflow: ghcr.io/groupsky/homy/nodered:${VERSION}
}

target "alpine" {
  context = "./alpine"
  # Tags set via workflow: ghcr.io/groupsky/homy/alpine:${VERSION}
}

target "nginx" {
  context = "./nginx"
  # Tags set via workflow: ghcr.io/groupsky/homy/nginx:${VERSION}
}

target "ubuntu" {
  context = "./ubuntu"
  # Tags set via workflow: ghcr.io/groupsky/homy/ubuntu:${VERSION}
}

target "dockergen" {
  context = "./dockergen"
  # Tags set via workflow: ghcr.io/groupsky/homy/dockergen:${VERSION}
}

target "wireguard" {
  context = "./wireguard"
  # Tags set via workflow: ghcr.io/groupsky/homy/wireguard:${VERSION}
}

target "mongo-express" {
  context = "./mongo-express"
  # Tags set via workflow: ghcr.io/groupsky/homy/mongo-express:${VERSION}
}
