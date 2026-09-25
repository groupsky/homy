#!/usr/bin/env bats
#
# volman's completeness marker (#1590): a backup is restorable only once
# `seal` has written its COMPLETE manifest, and `restore` refuses - before
# extracting anything - a backup without it or missing a volume.
# Runs docker/volman/entrypoint.sh directly on scratch directories.

load test_helper

setup() {
    setup_test_env
    ENTRY="${BATS_TEST_DIRNAME}/../../docker/volman/entrypoint.sh"
    export BACKUP_ROOT="$TEST_DIR/backup" VOLUMES_ROOT="$TEST_DIR/volumes" VOLUMES="ha influxdb"
    mkdir -p "$BACKUP_ROOT" "$VOLUMES_ROOT/ha" "$VOLUMES_ROOT/influxdb"
    echo "ha v1" > "$VOLUMES_ROOT/ha/config"
    echo "influx v1" > "$VOLUMES_ROOT/influxdb/data"
}

teardown() {
    teardown_test_env
}

volman() {
    bash "$ENTRY" "$@"
}

new_backup() {
    volman backup > /dev/null
    ls "$BACKUP_ROOT"
}

@test "volman backup: writes the volume archives but no COMPLETE marker" {
    name=$(new_backup)
    [ -f "$BACKUP_ROOT/$name/ha.tar" ]
    [ -f "$BACKUP_ROOT/$name/influxdb.tar" ]
    [ ! -e "$BACKUP_ROOT/$name/COMPLETE" ]
}

@test "volman restore: refuses a backup without COMPLETE and extracts nothing" {
    name=$(new_backup)
    echo "ha v2" > "$VOLUMES_ROOT/ha/config"

    run volman restore "$name"
    assert_failure
    assert_output --partial "Backup $name is not complete: it has no COMPLETE manifest"
    assert_output --partial "nothing was extracted"
    assert_equal "$(cat "$VOLUMES_ROOT/ha/config")" "ha v2"
}

@test "volman seal: writes the manifest with every file, its size and time, and the mode" {
    name=$(new_backup)
    echo "dump" > "$BACKUP_ROOT/$name/mongo.archive.gz"

    run volman seal "$name" stopped
    assert_success
    run cat "$BACKUP_ROOT/$name/COMPLETE"
    assert_line "services=stopped"
    assert_line --regexp "^sealed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$"
    assert_line --regexp "^file=ha\.tar	[0-9]+	[0-9T:-]+Z$"
    assert_line --regexp "^file=influxdb\.tar	[0-9]+	"
    assert_line --regexp "^file=mongo\.archive\.gz	5	"
}

@test "volman seal: refuses a backup that lacks one of the volumes" {
    name=$(new_backup)
    rm "$BACKUP_ROOT/$name/influxdb.tar"

    run volman seal "$name" stopped
    assert_failure
    assert_output --partial "has no influxdb.tar; not sealing it"
    [ ! -e "$BACKUP_ROOT/$name/COMPLETE" ]
}

@test "volman restore: restores a sealed backup" {
    name=$(new_backup)
    volman seal "$name" stopped
    echo "ha v2" > "$VOLUMES_ROOT/ha/config"
    echo "influx v2" > "$VOLUMES_ROOT/influxdb/data"

    run volman restore "$name"
    assert_success
    assert_equal "$(cat "$VOLUMES_ROOT/ha/config")" "ha v1"
    assert_equal "$(cat "$VOLUMES_ROOT/influxdb/data")" "influx v1"
}

@test "volman restore: refuses, naming it, when a sealed volume archive is gone" {
    name=$(new_backup)
    volman seal "$name" stopped
    rm "$BACKUP_ROOT/$name/influxdb.tar"
    echo "ha v2" > "$VOLUMES_ROOT/ha/config"

    run volman restore "$name"
    assert_failure
    assert_output --partial "Backup $name is missing: influxdb"
    # checked before extracting: ha was not restored either
    assert_equal "$(cat "$VOLUMES_ROOT/ha/config")" "ha v2"
}

@test "volman restore: warns about a backup taken with the services running" {
    name=$(new_backup)
    volman seal "$name" running

    run volman restore "$name"
    assert_success
    assert_output --partial "WARNING: backup $name was taken while the services were running"
}

@test "volman list: shows whether each backup is complete and how many volumes it holds" {
    mkdir -p "$BACKUP_ROOT/2026_09_08_06_58_54" "$BACKUP_ROOT/2026_09_09_06_44_27"
    touch "$BACKUP_ROOT/2026_09_08_06_58_54/ha.tar"
    touch "$BACKUP_ROOT/2026_09_09_06_44_27/ha.tar" "$BACKUP_ROOT/2026_09_09_06_44_27/influxdb.tar"
    VOLUMES="ha influxdb" volman seal 2026_09_09_06_44_27 stopped > /dev/null

    run volman list
    assert_success
    assert_line --regexp "^2026_09_08_06_58_54	.*	INCOMPLETE	1 volumes$"
    assert_line --regexp "^2026_09_09_06_44_27	.*	complete  	2 volumes$"
}
