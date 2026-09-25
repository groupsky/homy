#!/usr/bin/env bats
#
# The manual data restore from a deploy snapshot (#1607), against a scratch
# directory standing in for the dataset and a fake zfs and docker:
# it asks first, stops only the services that use the restored directories,
# copies them back from <mountpoint>/.zfs/snapshot/<snap>/..., keeps the
# current data aside instead of deleting it, and starts the services again.

load test_helper
load mock_stack

bats_require_minimum_version 1.5.0

SNAP=homy-deploy-20260925T101500Z-abc1234

setup() {
    setup_test_env
    setup_mock_stack
    install_mock_zfs

    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    cp "${BATS_TEST_DIRNAME}/../restore-snapshot.sh" "$PROJECT_DIR/scripts/restore-snapshot.sh"
    chmod +x "$PROJECT_DIR/scripts/"*.sh

    # root is required; pretend
    printf '#!/bin/bash\n[ "$1" = "-u" ] && { echo "${MOCK_UID:-0}"; exit 0; }\nexec /usr/bin/id "$@"\n' > "$MOCK_BIN/id"
    chmod +x "$MOCK_BIN/id"

    MP="$TEST_DIR/tank/homy"
    SNAPDIR="$MP/.zfs/snapshot/$SNAP"
    for d in influxdb home-assistant grafana automations/state; do
        mkdir -p "$MP/data/$d" "$SNAPDIR/data/$d"
        echo "live $d" > "$MP/data/$d/file"
        echo "snapshot $d" > "$SNAPDIR/data/$d/file"
    done
    mkdir -p "$SNAPDIR/data/influxdb/data/db1"
    echo "shard" > "$SNAPDIR/data/influxdb/data/db1/000001.tsm"
    echo "$MP" > "$MOCK_DIR/zfs/mountpoint"
    printf '%s\t%s\n' "$MP" "tank/homy" > "$MOCK_DIR/zfs/datasets"
    echo "tank/homy@$SNAP" > "$MOCK_DIR/zfs/snapshots"

    jq -n --arg d "$MP/data" '{services: {
        influxdb: {restart: "unless-stopped", volumes: [{type: "bind", source: ($d + "/influxdb"), target: "/var/lib/influxdb"}]},
        ha: {restart: "unless-stopped", volumes: [{type: "bind", source: ($d + "/home-assistant"), target: "/config"}]},
        grafana: {restart: "unless-stopped", volumes: [{type: "bind", source: ($d + "/grafana"), target: "/var/lib/grafana"}]},
        automations: {restart: "unless-stopped", volumes: [{type: "bind", source: ($d + "/automations/state"), target: "/app/state"}]},
        "boiler-controller": {restart: "unless-stopped", volumes: [{type: "bind", source: ($d + "/automations/state"), target: "/app/state"}]},
        mqtt: {restart: "unless-stopped"},
        volman: {restart: "no", volumes: [{type: "bind", source: ($d + "/influxdb"), target: "/volumes/influxdb"}]}
    }}' > "$MOCK_DIR/config.json"
    {
        for s in influxdb ha grafana automations boiler-controller mqtt; do
            mock_container "$s" "c-$s" "img-$s" running
        done
    } | mock_containers

    export QUIET=0 YES_FLAG=0
}

teardown() {
    teardown_test_env
}

restore() {
    cd "$PROJECT_DIR"
    scripts/restore-snapshot.sh "$@"
}

status_of() {
    jq -r --arg s "$1" '.[] | select(.Config.Labels["com.docker.compose.service"] == $s) | .State.Status' "$MOCK_DIR/containers.json"
}

@test "restore-snapshot.sh: asks first; answering no changes nothing" {
    # (read prints its prompt only on a terminal; the answer is what counts)
    run restore --snapshot "tank/homy@$SNAP" influxdb <<<"n"
    assert_success
    assert_output --partial "Restore cancelled; nothing was changed"
    assert_equal "$(cat "$MP/data/influxdb/file")" "live influxdb"
    run grep -E "compose (stop|start)" "$MOCK_DIR/calls.log"
    assert_failure
}

@test "restore-snapshot.sh: no answer at all means no" {
    run restore --snapshot "tank/homy@$SNAP" influxdb < /dev/null
    assert_output --partial "Restore cancelled"
    assert_equal "$(cat "$MP/data/influxdb/file")" "live influxdb"
}

@test "restore-snapshot.sh: copies the directory back from the snapshot and keeps the current data aside" {
    run restore --snapshot "tank/homy@$SNAP" influxdb <<<"y"
    assert_success

    assert_equal "$(cat "$MP/data/influxdb/file")" "snapshot influxdb"
    assert_equal "$(cat "$MP/data/influxdb/data/db1/000001.tsm")" "shard"
    aside=$(ls -d "$MP/data/influxdb.pre-restore-"*)
    assert_equal "$(cat "$aside/file")" "live influxdb"
    # the snapshot itself is untouched
    assert_equal "$(cat "$SNAPDIR/data/influxdb/file")" "snapshot influxdb"
    # the other services' data is untouched
    assert_equal "$(cat "$MP/data/home-assistant/file")" "live home-assistant"
}

@test "restore-snapshot.sh: stops and starts only the affected services" {
    run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_success

    run grep -E "compose (stop|start)" "$MOCK_DIR/calls.log"
    assert_line --index 0 --partial "docker compose stop influxdb"
    assert_line --index 1 --partial "docker compose start influxdb"
    assert_equal "${#lines[@]}" "2"
    # one-shot volman mounts the same directory but is not a running service
    refute_output --partial "volman"
    for s in influxdb ha grafana automations mqtt; do
        assert_equal "$(status_of "$s")" "running"
    done
}

@test "restore-snapshot.sh: a directory shared by two services stops both" {
    run restore --snapshot "tank/homy@$SNAP" -y automations
    assert_success
    run grep -E "compose stop" "$MOCK_DIR/calls.log"
    assert_output --partial "compose stop automations boiler-controller"
}

@test "restore-snapshot.sh: restores several services in one go" {
    run restore --snapshot "tank/homy@$SNAP" -y influxdb ha
    assert_success
    assert_equal "$(cat "$MP/data/influxdb/file")" "snapshot influxdb"
    assert_equal "$(cat "$MP/data/home-assistant/file")" "snapshot home-assistant"
    assert_equal "$(cat "$MP/data/grafana/file")" "live grafana"
    run grep -E "compose stop" "$MOCK_DIR/calls.log"
    assert_output --partial "compose stop ha influxdb"
}

@test "restore-snapshot.sh: defaults to the snapshot the last deploy recorded" {
    echo "tank/homy@$SNAP" > "$PROJECT_DIR/.pre-deploy-snapshot"
    run restore -y ha
    assert_success
    assert_equal "$(cat "$MP/data/home-assistant/file")" "snapshot home-assistant"
}

@test "restore-snapshot.sh: never rolls back or destroys anything in zfs" {
    run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_success
    run cat "$MOCK_DIR/zfs/calls.log"
    refute_output --partial "rollback"
    refute_output --partial "destroy"
}

@test "restore-snapshot.sh: does not touch the data while a service still runs" {
    touch "$MOCK_DIR/stop-noop"
    run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_failure
    assert_output --partial "Still running after stop: influxdb; nothing was restored"
    assert_equal "$(cat "$MP/data/influxdb/file")" "live influxdb"
}

@test "restore-snapshot.sh: refuses when the copies would not fit" {
    echo 1024 > "$MOCK_DIR/zfs/avail"
    run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_failure
    assert_output --partial "The copies need"
    assert_equal "$(cat "$MP/data/influxdb/file")" "live influxdb"
}

@test "restore-snapshot.sh: refuses to run as a normal user" {
    MOCK_UID=1000 run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_failure
    assert_output --partial "Run as root"
}

@test "restore-snapshot.sh: refuses a snapshot that is not a deploy snapshot" {
    run restore --snapshot "tank/homy@manual-1" -y influxdb
    assert_failure
    assert_output --partial "Not a deploy snapshot name"
}

@test "restore-snapshot.sh: refuses a snapshot that does not exist" {
    run restore --snapshot "tank/homy@homy-deploy-20260101T000000Z-0000000" -y influxdb
    assert_failure
    assert_output --partial "does not exist"
}

@test "restore-snapshot.sh: refuses an unknown service and one without data" {
    run restore --snapshot "tank/homy@$SNAP" -y nosuch
    assert_failure
    assert_output --partial "No service named nosuch"
    run restore --snapshot "tank/homy@$SNAP" -y mqtt
    assert_failure
    assert_output --partial "mqtt has no data directory to restore"
}

@test "restore-snapshot.sh: refuses a directory that is not in the snapshot" {
    rm -rf "$SNAPDIR/data/grafana"
    run restore --snapshot "tank/homy@$SNAP" -y grafana
    assert_failure
    assert_output --partial "is not in snapshot"
    assert_equal "$(cat "$MP/data/grafana/file")" "live grafana"
}

@test "restore-snapshot.sh: --no-start restores and leaves the services stopped" {
    run restore --snapshot "tank/homy@$SNAP" -y --no-start ha
    assert_success
    assert_equal "$(cat "$MP/data/home-assistant/file")" "snapshot home-assistant"
    assert_equal "$(status_of ha)" "exited"
    run grep -c "compose start" "$MOCK_DIR/calls.log"
    assert_output "0"
}

@test "restore-snapshot.sh: refuses a directory on a child dataset (the snapshot only has an empty directory there)" {
    printf '%s\t%s\n' "$MP" "tank/homy" "$MP/data/influxdb" "tank/homy/influxdb" > "$MOCK_DIR/zfs/datasets"
    run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_failure
    assert_output --partial "is on another dataset than tank/homy"
    assert_equal "$(cat "$MP/data/influxdb/file")" "live influxdb"
}

@test "restore-snapshot.sh: a failed copy puts the current data back and leaves the services stopped" {
    # cp fails half way (disk full, I/O error)
    printf '#!/bin/bash\nmkdir -p "${@: -1}"; echo "cp: write error" >&2; exit 1\n' > "$MOCK_BIN/cp"
    chmod +x "$MOCK_BIN/cp"

    run restore --snapshot "tank/homy@$SNAP" -y influxdb
    assert_failure
    assert_output --partial "Services left stopped: influxdb"
    assert_equal "$(cat "$MP/data/influxdb/file")" "live influxdb"
    ls -d "$MP/data/influxdb.failed-restore-"*
    assert_equal "$(status_of influxdb)" "exited"
    run grep -c "compose start" "$MOCK_DIR/calls.log"
    assert_output "0"
}

@test "restore-snapshot.sh: --list shows the deploy snapshots" {
    run restore --list
    assert_success
    assert_output --partial "tank/homy@$SNAP"
}
