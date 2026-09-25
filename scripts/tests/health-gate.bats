#!/usr/bin/env bats
#
# The deploy health gate (#1545, #1607): it waits on the recreated services
# only, honours start periods, gives services without a healthcheck the 30 s
# restart-count rule, skips one-shot services, and fails loudly (status 2)
# when it cannot check at all - it never passes by default.
#
# Time is faked: _gate_now reads $MOCK_DIR/clock and _gate_sleep advances it,
# and the mock docker can make a container change with the clock (inspect.jq).

load test_helper
load mock_stack

bats_require_minimum_version 1.5.0

setup() {
    setup_test_env
    setup_mock_stack
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    _gate_now() { cat "$MOCK_DIR/clock"; }
    _gate_sleep() { echo $(( $(cat "$MOCK_DIR/clock") + $1 )) > "$MOCK_DIR/clock"; }

    export QUIET=0
    HEALTH_POLL_INTERVAL=5
    HEALTH_STABLE_SECONDS=30
    HEALTH_GATE_MARGIN=60
}

teardown() {
    teardown_test_env
}

clock() { cat "$MOCK_DIR/clock"; }

# Give a container a healthcheck with these timings (seconds)
set_healthcheck() {
    local id="$1" start="$2" interval="$3" retries="$4" timeout="$5"
    jq --arg id "$id" --argjson sp "$start" --argjson iv "$interval" --argjson rt "$retries" --argjson to "$timeout" '
        map(if .Id == $id then .Config.Healthcheck = {Test: ["CMD", "true"], StartPeriod: ($sp * 1000000000),
            Interval: ($iv * 1000000000), Retries: $rt, Timeout: ($to * 1000000000)} else . end)' \
        "$MOCK_DIR/containers.json" > "$MOCK_DIR/c.tmp" && mv "$MOCK_DIR/c.tmp" "$MOCK_DIR/containers.json"
}

@test "health_gate: nothing recreated passes without checking anything" {
    run health_gate
    assert_success
    assert_output --partial "no service was recreated"
    run grep -c "docker inspect" "$MOCK_DIR/calls.log"
    assert_output "0"
}

@test "health_gate: a service whose healthcheck reports healthy passes" {
    mock_container influxdb c-influx img-1 running healthy | mock_containers

    run health_gate influxdb
    assert_success
    assert_output --partial "influxdb: healthy"
    assert_output --partial "Health gate passed"
}

@test "health_gate: waits through a start period until healthy" {
    mock_container influxdb c-influx img-1 running starting | mock_containers
    set_healthcheck c-influx 300 1 3 1
    echo 'if .Id == "c-influx" then .State.Health.Status = (if $now >= 120 then "healthy" else "starting" end) else . end' > "$MOCK_DIR/inspect.jq"

    run health_gate influxdb
    assert_success
    [ "$(clock)" -ge 120 ]
}

@test "health_gate: timeout is longer than start period + interval x retries + timeout" {
    mock_container influxdb c-influx img-1 running starting | mock_containers
    set_healthcheck c-influx 300 1 3 1

    run health_gate influxdb
    assert_failure 1
    # 300 + 1 x 3 + 1 = 304, plus the 60 s margin
    assert_output --partial "waiting up to 364s"
    assert_output --partial "influxdb (still running, health starting after 364s)"
    [ "$(clock)" -ge 364 ]
}

@test "health_gate: the timeout follows the slowest service it waits on" {
    {
        mock_container influxdb c-influx img-1 running healthy
        mock_container z2m-home1 c-z2m img-2 running healthy
    } | mock_containers
    set_healthcheck c-influx 300 1 3 1
    set_healthcheck c-z2m 120 60 5 10

    run health_gate influxdb z2m-home1
    assert_success
    # z2m: 120 + 60 x 5 + 10 = 430 > influxdb's 304
    assert_output --partial "waiting up to 490s"
}

@test "health_gate: uses docker's defaults for a healthcheck without timings" {
    mock_container ha c-ha img-1 running healthy | mock_containers

    run health_gate ha
    assert_success
    # 0 + 30 x 3 + 30 = 120, plus 60
    assert_output --partial "waiting up to 180s"
}

@test "health_gate: fails at once when a service turns unhealthy" {
    mock_container ha c-ha img-1 running unhealthy | mock_containers

    run health_gate ha
    assert_failure 1
    assert_output --partial "Health gate failed: ha (unhealthy)"
    [ "$(clock)" -eq 0 ]
}

@test "health_gate: fails when a service with a healthcheck exits" {
    mock_container ha c-ha img-1 exited starting | mock_containers

    run health_gate ha
    assert_failure 1
    assert_output --partial "ha (exited)"
}

@test "health_gate: no healthcheck passes after 30 s running without a restart" {
    mock_container automations c-auto img-1 running | mock_containers

    run health_gate automations
    assert_success
    assert_output --partial "automations: running, no restart for 30s"
    [ "$(clock)" -ge 30 ]
    [ "$(clock)" -lt 40 ]
}

@test "health_gate: a restart starts the 30 s over" {
    mock_container automations c-auto img-1 running | mock_containers
    echo 'if .Id == "c-auto" then .RestartCount = (if $now >= 20 then 1 else 0 end) else . end' > "$MOCK_DIR/inspect.jq"

    run health_gate automations
    assert_success
    [ "$(clock)" -ge 50 ]
}

@test "health_gate: a crash-looping service without a healthcheck fails" {
    mock_container automations c-auto img-1 running | mock_containers
    echo 'if .Id == "c-auto" then .RestartCount = (($now / 10) | floor) else . end' > "$MOCK_DIR/inspect.jq"

    run health_gate automations
    assert_failure 1
    # 30 s rule + 60 s margin
    assert_output --partial "waiting up to 90s"
    assert_output --partial "automations (still running, restart count"
}

@test "health_gate: a stopped service without a healthcheck fails after the timeout" {
    mock_container automations c-auto img-1 exited | mock_containers

    run health_gate automations
    assert_failure 1
    assert_output --partial "automations (still exited"
}

@test "health_gate: one-shot services are skipped" {
    {
        mock_container volman c-volman img-1 exited "" no
        mock_container automations c-auto img-2 running
    } | mock_containers
    HEALTH_STABLE_SECONDS=0

    run health_gate volman automations
    assert_success
    assert_output --partial "volman: skipped (one-shot, restart: no)"
    refute_output --partial "volman (still"
}

@test "health_gate: only one-shot services changed means nothing to wait for" {
    mock_container volman c-volman img-1 exited "" no | mock_containers

    run health_gate volman
    assert_success
    assert_output --partial "nothing to wait for"
}

@test "health_gate: waits only on the services it is given" {
    {
        mock_container automations c-auto img-1 running
        mock_container ha c-ha img-2 running unhealthy
    } | mock_containers
    HEALTH_STABLE_SECONDS=0

    run health_gate automations
    assert_success
    refute_output --partial "ha"
}

@test "health_gate: fails loudly (2) when a service has no container" {
    mock_container automations c-auto img-1 running | mock_containers

    run health_gate automations ghost
    assert_failure 2
    assert_output --partial "ERROR: Health gate cannot check ghost"
}

@test "health_gate: fails loudly (2) when docker inspect fails" {
    mock_container automations c-auto img-1 running | mock_containers
    touch "$MOCK_DIR/fail-inspect"

    run health_gate automations
    assert_failure 2
    assert_output --partial "ERROR: Health gate cannot check"
}

@test "health_gate: fails loudly (2) on docker-compose v1 instead of assuming health" {
    mock_container automations c-auto img-1 running | mock_containers
    export MOCK_COMPOSE_VERSION="docker-compose version 1.27.4, build 40524192"

    run health_gate automations
    assert_failure 2
    assert_output --partial "docker compose v2 or newer is required"
    refute_output --partial "Health gate passed"
}

@test "wait_for_health: gates every long-running service of the compose config" {
    cat > "$MOCK_DIR/config.json" <<'EOF'
{"services": {
  "automations": {"image": "a:1", "restart": "unless-stopped"},
  "ha": {"image": "h:1", "restart": "unless-stopped"},
  "volman": {"image": "v:1", "restart": "no"}
}}
EOF
    {
        mock_container automations c-auto img-1 running
        mock_container ha c-ha img-2 running healthy
    } | mock_containers
    HEALTH_STABLE_SECONDS=0

    run wait_for_health
    assert_success
    assert_output --partial "waiting up to"
    assert_output --partial "ha: healthy"
    assert_output --partial "automations: running"
    refute_output --partial "volman"
}

@test "health_gate: fails loudly (2) when a service has more than one container" {
    {
        mock_container automations c-auto img-1 running
        mock_container automations c-auto-leftover img-0 exited
    } | mock_containers

    run health_gate automations
    assert_failure 2
    assert_output --partial "automations: it has more than one container"
}

@test "health_gate: names the failed services for the rollback" {
    {
        mock_container ha c-ha img-1 running unhealthy
        mock_container automations c-auto img-2 running
    } | mock_containers

    health_gate ha automations || true
    assert_equal "$HEALTH_GATE_FAILED_SERVICES" "ha "
}
