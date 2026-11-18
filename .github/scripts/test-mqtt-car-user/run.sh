#!/usr/bin/env bash
# Integration test for the car-only MQTT user (#1962), with the real broker
# config (config/mosquitto/broker.conf, car.acl) and image (docker/mosquitto).
#
# Port 1883 is anonymous; port 1884 needs a login and uses car.acl. Checks:
#   a. the car user can publish to its own topic (ioniq/...);
#   b. it can read homy/ioniq/journeys and homy/ioniq/road_check;
#   c. it cannot publish to homy/ioniq/journeys;
#   d. it cannot read or write any other topic, also ioniq/derived/...;
#   e. a client without a login, or with a wrong password, cannot use 1884;
#   f. with no password file the broker still starts, 1883 works, and nobody
#      can log in on 1884.
# The broker drops a publish the ACL denies without an error, so every check
# reads a retained message back.
#
# Needs docker (with compose). Run from anywhere.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"
export SECRETS_DIR="$WORK/secrets"
mkdir "$SECRETS_DIR"

dc() { docker compose -p mqtt-car-user-test -f "$HERE/compose.yml" "$@"; }
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then dc logs | tail -40 || true; fi
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }
log() { echo "[$(date +%T)] $*"; }

# wait_for SECONDS DESCRIPTION COMMAND...: runs COMMAND every 2s until it succeeds.
wait_for() {
  local limit=$1 what=$2; shift 2
  local end=$((SECONDS + limit))
  until "$@" >/dev/null 2>&1; do
    [ "$SECONDS" -lt "$end" ] || fail "timed out after ${limit}s waiting for: $what"
    sleep 2
  done
  log "ok: $what"
}

log "starting the broker"
dc build --quiet
# The password file, made the way docs/mqtt-car-user.md says.
dc run --rm --no-deps -T -v "$SECRETS_DIR:/out" --entrypoint mosquitto_passwd broker \
  -c -b /out/passwd ioniq test-password
dc up -d broker broker-nopass

SVC=broker
# anon ARGS...: mosquitto_pub/sub on 1883 without a login. car: on 1884 as the car.
pub_anon() { dc exec -T "$SVC" mosquitto_pub -p 1883 -q 1 -r "$@"; }
pub_car()  { dc exec -T "$SVC" mosquitto_pub -p 1884 -u ioniq -P test-password -q 1 -r "$@"; }
# retained TOPIC (anonymous) / retained_car TOPIC: the retained message, or
# nothing after 3s.
retained()     { dc exec -T "$SVC" mosquitto_sub -p 1883 -C 1 -W 3 -t "$1" 2>/dev/null || true; }
retained_car() { dc exec -T "$SVC" mosquitto_sub -p 1884 -u ioniq -P test-password -C 1 -W 3 -t "$1" 2>/dev/null || true; }
# refused SERVICE ARGS...: mosquitto_pub ARGS fails because the broker says
# "not authorised" (not because nothing listens).
refused() {
  local svc=$1 out; shift
  if out=$(dc exec -T "$svc" mosquitto_pub "$@" 2>&1); then return 1; fi
  grep -q "not authorised" <<<"$out"
}
is() { [ "$1" = "$2" ] || fail "$3: got '$1', want '$2'"; log "ok: $3"; }

wait_for 30 "broker is up" dc exec -T broker mosquitto_sub -p 1883 -t '$SYS/#' -C 1
wait_for 30 "car can log in" dc exec -T broker mosquitto_sub -p 1884 -u ioniq -P test-password -t ioniq/status -E

# a. its own topics, also the will/status topic.
pub_car -t ioniq/parsed/gps -m car-gps
is "$(retained ioniq/parsed/gps)" car-gps "a: car publishes ioniq/parsed/gps"
pub_car -t ioniq/status -m '{"online":true}'
is "$(retained ioniq/status)" '{"online":true}' "a: car publishes ioniq/status"

# b. what ev-journal publishes for the car.
pub_anon -t homy/ioniq/journeys -m journeys-1
pub_anon -t homy/ioniq/road_check -m road-1
is "$(retained_car homy/ioniq/journeys)" journeys-1 "b: car reads homy/ioniq/journeys"
is "$(retained_car homy/ioniq/road_check)" road-1 "b: car reads homy/ioniq/road_check"

# c. no write to ev-journal's topics.
pub_car -t homy/ioniq/journeys -m from-car || true
is "$(retained homy/ioniq/journeys)" journeys-1 "c: car cannot publish homy/ioniq/journeys"
pub_car -t homy/ioniq/notice -m from-car || true
is "$(retained homy/ioniq/notice)" "" "c: car cannot publish homy/ioniq/notice"

# d. nothing else.
pub_anon -t homy/other/state -m other-1
is "$(retained_car homy/other/state)" "" "d: car cannot read homy/other/state"
is "$(retained_car homy/ioniq/charges)" "" "d: car cannot read homy/ioniq/charges"
pub_car -t homy/other/state -m from-car || true
is "$(retained homy/other/state)" other-1 "d: car cannot publish homy/other/state"
pub_car -t other/x -m from-car || true
is "$(retained other/x)" "" "d: car cannot publish other/x"
pub_anon -t ioniq/derived/trip -m trip-1
pub_car -t ioniq/derived/trip -m from-car || true
is "$(retained ioniq/derived/trip)" trip-1 "d: car cannot publish ioniq/derived/trip"

# e. no login, or a wrong one, on the car's listener.
refused broker -p 1884 -t ioniq/status -m anon ||
  fail "e: a client without a login could publish on 1884"
log "ok: e: no login is refused on 1884"
refused broker -p 1884 -u ioniq -P wrong -t ioniq/status -m bad ||
  fail "e: a wrong password could publish on 1884"
log "ok: e: a wrong password is refused on 1884"
is "$(retained ioniq/status)" '{"online":true}' "e: ioniq/status unchanged"

# f. no password file.
SVC=broker-nopass
wait_for 30 "broker without a password file is up" dc exec -T broker-nopass mosquitto_sub -p 1883 -t '$SYS/#' -C 1
pub_anon -t test/anon -m anon-1
is "$(retained test/anon)" anon-1 "f: 1883 works without a password file"
refused broker-nopass -p 1884 -u ioniq -P test-password -t ioniq/status -m x ||
  fail "f: the car could log in without a password file"
log "ok: f: nobody can log in on 1884 without a password file"

log "PASS"
