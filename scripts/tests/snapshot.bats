#!/usr/bin/env bats
#
# The pre-deploy snapshot (#1607): one ZFS snapshot of the dataset that holds
# every persistent host mount, resolved at run time, named exactly
#   <dataset>@homy-deploy-<UTC yyyymmddThhmmssZ>-<short sha>
# and refused when the data is split over datasets, kept in Docker volumes,
# not on ZFS, or the pool is short of space.

load test_helper
load mock_stack

bats_require_minimum_version 1.5.0

setup() {
    setup_test_env
    setup_mock_stack
    install_mock_zfs
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    cp "${BATS_TEST_DIRNAME}/../snapshot.sh" "$PROJECT_DIR/scripts/snapshot.sh"
    chmod +x "$PROJECT_DIR/scripts/"*.sh

    export QUIET=0
    unset SNAPSHOT_MIN_FREE_GB
    DATA="$TEST_DIR/tank/homy"
    mkdir -p "$DATA/influxdb" "$DATA/mongodb/db" "$DATA/home-assistant" "$TEST_DIR/backup"

    # the stack's data on one dataset; the backup target on another
    printf '%s\t%s\n' "$DATA" "tank/homy" "$TEST_DIR/backup" "backup/homy" > "$MOCK_DIR/zfs/datasets"

    jq -n --arg d "$DATA" --arg b "$TEST_DIR/backup" '{services: {
        influxdb: {restart: "unless-stopped", volumes: [
            {type: "bind", source: ($d + "/influxdb"), target: "/var/lib/influxdb"},
            {type: "bind", source: "/etc/localtime", target: "/etc/localtime", read_only: true}]},
        mongo: {restart: "unless-stopped", volumes: [
            {type: "bind", source: ($d + "/mongodb/db"), target: "/data/db"},
            {type: "bind", source: ($d + "/mongodb/configdb"), target: "/data/configdb"}]},
        ha: {restart: "unless-stopped", volumes: [
            {type: "bind", source: ($d + "/home-assistant"), target: "/config"},
            {type: "bind", source: "/somewhere/else/configuration.yaml", target: "/config/configuration.yaml", read_only: true}]},
        vpn: {restart: "unless-stopped", volumes: [
            {type: "bind", source: "/lib/modules", target: "/lib/modules"}]},
        "main-power": {restart: "unless-stopped", volumes: [
            {type: "bind", source: "/dev/serial", target: "/dev/serial"}]},
        volman: {restart: "no", volumes: [
            {type: "bind", source: $b, target: "/backup"},
            {type: "bind", source: ($d + "/influxdb"), target: "/volumes/influxdb"}]}
    }}' > "$MOCK_DIR/config.json"
}

teardown() {
    teardown_test_env
}

snapshot() {
    cd "$PROJECT_DIR"
    scripts/snapshot.sh "$@"
}

@test "snapshot.sh: takes one snapshot with the exact name and prints only it on stdout" {
    run --separate-stderr snapshot --sha abc1234
    assert_success
    [[ "$output" =~ ^tank/homy@homy-deploy-[0-9]{8}T[0-9]{6}Z-abc1234$ ]]

    run cat "$MOCK_DIR/zfs/snapshots"
    [[ "$output" =~ ^tank/homy@homy-deploy-[0-9]{8}T[0-9]{6}Z-abc1234$ ]]
    [ "$(wc -l < "$MOCK_DIR/zfs/snapshots")" -eq 1 ]
}

@test "snapshot.sh: the timestamp in the name is UTC" {
    run --separate-stderr env TZ=Pacific/Kiritimati "$PROJECT_DIR/scripts/snapshot.sh" --sha abc1234
    assert_success
    stamp=$(sed -E 's/.*homy-deploy-([0-9]{8}T[0-9]{4}).*/\1/' <<<"$output")
    # minutes precision: the run takes well under a minute
    [ "$stamp" = "$(date -u +%Y%m%dT%H%M)" ] || [ "$stamp" = "$(date -u -d '1 minute ago' +%Y%m%dT%H%M)" ]
}

@test "snapshot.sh: records the snapshot for the rollback and the restore" {
    run --separate-stderr snapshot --sha abc1234
    assert_success
    assert_equal "$(cat "$PROJECT_DIR/.pre-deploy-snapshot")" "$output"
}

@test "snapshot.sh: resolves the dataset of every writable data mount, skipping system and one-shot mounts" {
    run snapshot --sha abc1234
    assert_success
    assert_output --partial "All 4 data mounts are on dataset tank/homy"

    run cat "$MOCK_DIR/zfs/calls.log"
    assert_line "zfs list -H -o name $DATA/influxdb"
    assert_line "zfs list -H -o name $DATA/mongodb/db"
    assert_line "zfs list -H -o name $DATA/home-assistant"
    refute_line --partial "/lib/modules"
    refute_line --partial "/dev/serial"
    refute_line --partial "/etc/localtime"
    refute_line --partial "$TEST_DIR/backup"
}

@test "snapshot.sh: a directory not created yet is resolved through its parent" {
    run snapshot --sha abc1234
    assert_success
    # mongodb/configdb does not exist: its parent is asked instead
    run cat "$MOCK_DIR/zfs/calls.log"
    assert_line "zfs list -H -o name $DATA/mongodb"
}

@test "snapshot.sh: refuses when the data is on more than one dataset" {
    printf '%s\t%s\n' "$DATA" "tank/homy" "$DATA/influxdb" "tank/homy/influxdb" > "$MOCK_DIR/zfs/datasets"

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "more than one dataset"
    assert_output --partial "influxdb $DATA/influxdb -> tank/homy/influxdb"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
    run grep -c "^zfs snapshot" "$MOCK_DIR/zfs/calls.log"
    assert_output "0"
}

@test "snapshot.sh: refuses when some data is not on ZFS" {
    printf '%s\t%s\n' "$DATA/influxdb" "tank/homy" > "$MOCK_DIR/zfs/datasets"

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "which is not on ZFS"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}

@test "snapshot.sh: refuses when there is no zfs command at all" {
    rm "$MOCK_BIN/zfs"
    cd "$PROJECT_DIR"
    PATH="$MOCK_BIN:/usr/bin:/bin" run scripts/snapshot.sh --sha abc1234
    assert_failure
    assert_output --partial "not on ZFS here (no zfs command)"
}

@test "snapshot.sh: refuses when a service keeps state in a Docker volume" {
    jq '.services.mongo.volumes += [{type: "volume", source: "mongo-data", target: "/data/db"}]' "$MOCK_DIR/config.json" > "$MOCK_DIR/c2"
    mv "$MOCK_DIR/c2" "$MOCK_DIR/config.json"

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "mongo: Docker volume mongo-data"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}

@test "snapshot.sh: refuses when a running container has an unnamed volume" {
    mock_container broker c-broker img-b | jq '.Mounts = [{Type: "volume", Name: "0a1b2c", Destination: "/mosquitto/data"}]' | mock_containers

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "broker: Docker volume 0a1b2c at /mosquitto/data"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}

@test "snapshot.sh: refuses when the pool has less free space than the limit" {
    echo $((5 * 1024 * 1024 * 1024)) > "$MOCK_DIR/zfs/avail"

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "Pool tank has 5 GiB free, less than the 20 GiB limit"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}

@test "snapshot.sh: the free-space limit can be set" {
    echo $((5 * 1024 * 1024 * 1024)) > "$MOCK_DIR/zfs/avail"

    SNAPSHOT_MIN_FREE_GB=4 run snapshot --sha abc1234
    assert_success
    run snapshot --sha abc1234 --min-free-gb 6
    assert_failure
}

@test "snapshot.sh: a failing zfs snapshot fails and records nothing" {
    touch "$MOCK_DIR/zfs/fail-snapshot"

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "zfs snapshot tank/homy@homy-deploy-"
    [ ! -e "$PROJECT_DIR/.pre-deploy-snapshot" ]
}

@test "snapshot.sh: a snapshot that is not there afterwards is a failure" {
    touch "$MOCK_DIR/zfs/lose-snapshot"

    run snapshot --sha abc1234
    assert_failure
    assert_output --partial "was not found after taking it"
    [ ! -e "$PROJECT_DIR/.pre-deploy-snapshot" ]
}

@test "snapshot.sh: --check verifies everything and takes no snapshot" {
    run snapshot --check
    assert_success
    assert_output --partial "Check passed"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}

@test "snapshot.sh: rejects a missing or unsafe --sha" {
    run snapshot
    assert_failure
    run snapshot --sha 'abc/../x'
    assert_failure
    assert_output --partial "--sha is required"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}
