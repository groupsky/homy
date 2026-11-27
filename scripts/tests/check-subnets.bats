#!/usr/bin/env bats
#
# check-subnets.sh (#1559): the host's compose config, Docker networks and
# routes go to check-subnets/index.mjs. docker and ip are faked.

load test_helper
load mock_stack

bats_require_minimum_version 1.5.0

setup() {
    setup_test_env
    setup_mock_stack
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "${BATS_TEST_DIRNAME}/../check-subnets.sh" "$PROJECT_DIR/scripts/"
    cp -r "${BATS_TEST_DIRNAME}/../check-subnets" "${BATS_TEST_DIRNAME}/../lib" "$PROJECT_DIR/scripts/"
    chmod +x "$PROJECT_DIR/scripts/"*.sh

    # ip: the routes in $MOCK_DIR/routes.txt
    printf '#!/bin/bash\ncat "$MOCK_DIR/routes.txt"\n' > "$MOCK_BIN/ip"
    chmod +x "$MOCK_BIN/ip"
    : > "$MOCK_DIR/routes.txt"

    echo '{"name": "homy", "networks": {
        "dmz": {"name": "homy_dmz", "ipam": {"config": [{"subnet": "10.28.28.0/24"}]}},
        "ingress": {"name": "homy_ingress", "ipam": {"config": [{"subnet": "10.28.29.0/24"}]}}}}' > "$MOCK_DIR/config.json"
}

teardown() {
    teardown_test_env
}

check() { "$PROJECT_DIR/scripts/check-subnets.sh"; }

@test "check-subnets.sh: passes when the host matches the pinned subnets" {
    echo '[{"Id": "a", "Name": "homy_dmz", "IPAM": {"Config": [{"Subnet": "10.28.28.0/24"}]}},
          {"Id": "b", "Name": "bridge", "IPAM": {"Config": [{"Subnet": "172.17.0.0/16"}]}}]' > "$MOCK_DIR/networks.json"
    QUIET=0 run check
    assert_success
    assert_output --partial "Subnet check passed"
}

@test "check-subnets.sh: fails when the host's dmz network swallows the ingress subnet (the #1558 case)" {
    echo '[{"Id": "a", "Name": "homy_dmz", "IPAM": {"Config": [{"Subnet": "10.28.0.0/16"}]}}]' > "$MOCK_DIR/networks.json"
    run check
    assert_failure 1
    assert_output --partial "network homy_ingress (10.28.29.0/24) overlaps the existing Docker network homy_dmz (10.28.0.0/16)"
}

@test "check-subnets.sh: fails on a host route" {
    printf 'default via 192.0.2.1 dev eth0\n10.28.29.0/24 dev tun0 scope link\n' > "$MOCK_DIR/routes.txt"
    run check
    assert_failure 1
    assert_output --partial "host route 10.28.29.0/24 (dev tun0)"
}

@test "check-subnets.sh: a failing docker compose config is a failure to run, exit 2" {
    touch "$MOCK_DIR/fail-config"
    run check
    assert_failure 2
    assert_output --partial "a required variable is missing from .env"
}

@test "check-subnets.sh: changes nothing and stops nothing" {
    echo '[{"Id": "a", "Name": "homy_dmz", "IPAM": {"Config": [{"Subnet": "10.28.0.0/16"}]}}]' > "$MOCK_DIR/networks.json"
    run check
    run cat "$MOCK_DIR/calls.log"
    refute_output --regexp "compose (up|stop|down|pull)|network (rm|create)"
}

@test "check-subnets.sh: a Docker daemon that cannot list networks is a failure to run, exit 2, not a pass" {
    touch "$MOCK_DIR/fail-network-ls"
    run check
    assert_failure 2
    assert_output --partial "Could not list the Docker networks"
}
