#!/usr/bin/env bash
# Integration test for the car app's alerts (#1881), with real services.
#
# The app publishes ioniq/parsed/alerts/<uid> (retained). mqtt-influx stores it,
# and the thin rule <uid>-app in ioniq-app-alerts.yaml reads `firing`. Checks:
#   a. a firing message fires the rule, the alert reaches Grafana's
#      Alertmanager with receiver `silent`, and firing 0 resolves it;
#   b. a firing and a resolved message sent together are both stored, and the
#      rule never fires;
#   c. no webhook is ever called: every contact point, `silent` included,
#      points at `sink`, so the mute timing `always` is what keeps it quiet.
#      As a control, Grafana's container must reach `sink` itself, so 0 can
#      not mean "sink was unreachable".
#
# Grafana gets only ioniq-app-alerts.yaml, contact-points.yaml and
# notification-policies.yaml, copied with two changes: the rule group is
# evaluated every 10s instead of 5m, and every webhook URL goes to `sink`.
#
# Needs docker (with compose), curl and jq. Run from anywhere.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
SRC="$REPO/config/grafana/provisioning/alerting"

FIRES=ioniq-isolation-low         # case a
SILENT=ioniq-isolation-critical   # case b

WORK="$(mktemp -d)"
export ALERTING_DIR="$WORK/alerting"
mkdir "$ALERTING_DIR"
sed 's/^\(    interval:\) .*$/\1 10s/' "$SRC/ioniq-app-alerts.yaml" > "$ALERTING_DIR/ioniq-app-alerts.yaml"
sed -E 's#url: http://[^ ]+#url: http://sink:8080/webhook#' "$SRC/contact-points.yaml" > "$ALERTING_DIR/contact-points.yaml"
cp "$SRC/notification-policies.yaml" "$ALERTING_DIR/"
chmod -R a+rX "$WORK"
grep -q 'interval: 10s' "$ALERTING_DIR/ioniq-app-alerts.yaml" || { echo "FAIL: interval not changed"; exit 1; }
[ "$(grep -c 'url: http://sink:8080/webhook' "$ALERTING_DIR/contact-points.yaml")" -eq \
  "$(grep -c 'url:' "$SRC/contact-points.yaml")" ] || { echo "FAIL: not every url points at sink"; exit 1; }

# The images must be the ones deployed on routy.
for svc in grafana influxdb mosquitto; do
  from=$(awk '/^FROM/ {print $2; exit}' "$REPO/docker/$svc/Dockerfile")
  grep -q "image: $from\$" "$HERE/compose.yml" || { echo "FAIL: compose.yml must use $from"; exit 1; }
done

dc() { docker compose -p ioniq-app-alerts-test -f "$HERE/compose.yml" "$@"; }
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then dc logs grafana mqtt-influx | grep -v "logger=migrator" | tail -40 || true; fi
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

log "starting services"
dc up -d --build --quiet-pull
GRAFANA="http://admin:admin@$(dc port grafana 3000)"

influx() { dc exec -T influxdb influx -database test -format csv -execute "$1"; }
wait_for 60 "InfluxDB is up" influx 'CREATE DATABASE test'
wait_for 90 "Grafana is up" curl -fsS "$GRAFANA/api/health"

# publish UID FIRING TS: sends the app's message, retained, as the app does.
publish() {
  local uid=$1 firing=$2 ts=$3
  dc exec -T broker mosquitto_pub -h localhost -q 1 -r -t "ioniq/parsed/alerts/$uid" -m "$(jq -cn \
    --arg uid "$uid" --argjson firing "$firing" --argjson ts "$ts" \
    '{_type: "ioniq", group: ("alerts/" + $uid), ts: $ts, uid: $uid, title: "test", summary: "test",
      severity: "warning", firing: $firing, starts_at: ($ts - 60000), value: 1, seq: 1, boot_id: "test", vin: "TEST"}')"
}

# rows UID: the stored firing values for the uid, oldest first, one per line.
rows() { influx "SELECT firing FROM ioniq WHERE \"group\"='alerts/$1'" | tail -n +2 | cut -d, -f3; }
rows_are() { [ "$(rows "$1" | paste -sd,)" = "$2" ]; }

# state UID: the rule's state in Grafana (inactive, pending or firing).
state() {
  curl -fsS "$GRAFANA/api/prometheus/grafana/api/v1/rules" |
    jq -er --arg q "alerts/$1'" '[.data.groups[].rules[] | select(.query | contains($q))] | first | .state'
}
state_is() { [ "$(state "$1")" = "$2" ]; }

# am_receivers UID: receiver names of the rule's alerts in Grafana's Alertmanager.
am_receivers() {
  curl -fsS "$GRAFANA/api/alertmanager/grafana/api/v2/alerts" |
    jq -r --arg uid "$1-app" '[.[] | select(.labels.__alert_rule_uid__ == $uid) | .receivers[].name] | join(",")'
}
in_am_as_silent() { [ "$(am_receivers "$1")" = "silent" ]; }

mqtt_influx_subscribed() { dc logs mqtt-influx | grep -q 'subscribed to'; }
wait_for 60 "mqtt-influx is subscribed" mqtt_influx_subscribed
wait_for 60 "Grafana loaded rule $FIRES-app" state_is "$FIRES" inactive

now=$(date +%s%3N)
log "a. $FIRES: firing 1"
publish "$FIRES" 1 "$now"
log "b. $SILENT: firing 1, then firing 0 five seconds later"
publish "$SILENT" 1 "$((now - 10000))"
publish "$SILENT" 0 "$((now - 5000))"

# mqtt-influx flushes its writes every 60s.
wait_for 90 "a. Influx has $FIRES (group=alerts/$FIRES)" rows_are "$FIRES" 1
wait_for 10 "b. Influx has both $SILENT rows" rows_are "$SILENT" 1,0
wait_for 30 "a. rule $FIRES-app fires" state_is "$FIRES" firing
wait_for 30 "a. alert $FIRES-app is in the Alertmanager with receiver silent" in_am_as_silent "$FIRES"

# Hold the alert past the root policy's group_wait (30s), when Grafana would
# send it; meanwhile the other rule is evaluated several times (every 10s).
log "b. watching $SILENT-app for 40s"
end=$((SECONDS + 40))
while [ "$SECONDS" -lt "$end" ]; do
  s=$(state "$SILENT"); [ "$s" = inactive ] || fail "b. rule $SILENT-app is $s"
  am=$(am_receivers "$SILENT"); [ -z "$am" ] || fail "b. alert $SILENT-app is in the Alertmanager"
  sleep 2
done
log "ok: b. rule $SILENT-app never fired, nothing in the Alertmanager"

log "a. $FIRES: firing 0"
publish "$FIRES" 0 "$(date +%s%3N)"
wait_for 90 "a. Influx has the resolve for $FIRES" rows_are "$FIRES" 1,0
wait_for 30 "a. rule $FIRES-app is back to normal" state_is "$FIRES" inactive

# Control: the rewritten webhook host is reachable from Grafana's container.
# This request is counted apart from the webhook calls.
dc exec -T grafana wget -q -O /dev/null --post-data=control http://sink:8080/control ||
  fail "c. control: Grafana's container cannot reach sink"
sink_got_control() { dc logs sink | grep -q 'REQUEST POST /control'; }
wait_for 10 "c. control: Grafana's container reaches sink" sink_got_control
sent=$(dc logs sink | grep REQUEST | grep -vc 'POST /control' || true)
[ "$sent" -eq 0 ] || fail "c. webhooks were called $sent time(s): $(dc logs sink | grep REQUEST)"
log "ok: c. no webhook was called"
log "PASS"
