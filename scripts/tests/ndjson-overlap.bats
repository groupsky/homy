#!/usr/bin/env bats
#
# The NDJSON / MongoDB overlap check (#1622): the writers and the raw directory
# come from the compose config, the Mongo documents from mongosh in the mongo
# container, and the comparison from ndjson-overlap/index.mjs. docker is faked:
# `compose exec mongo` prints $MOCK_DIR/mongo.<collection>.

load test_helper

bats_require_minimum_version 1.5.0

DAY=2026-01-15
START_MS=1768435200000

setup() {
    setup_test_env
    export MOCK_DIR="$TEST_DIR/mock" MOCK_BIN="$TEST_DIR/mockbin"
    mkdir -p "$MOCK_DIR" "$MOCK_BIN"
    : > "$MOCK_DIR/calls.log"
    # The binary itself: a version-manager shim may pick the fake node below
    REAL_NODE=$(node -p process.execPath)
    export REAL_NODE

    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "${BATS_TEST_DIRNAME}/../ndjson-overlap.sh" "$PROJECT_DIR/scripts/"
    cp -r "${BATS_TEST_DIRNAME}/../ndjson-overlap" "$PROJECT_DIR/scripts/"
    chmod +x "$PROJECT_DIR/scripts/"*.sh

    RAW="$TEST_DIR/data/raw"
    mkdir -p "$RAW/main" "$RAW/monitoring"
    jq -n --arg raw "$RAW" '{services: {
        "main-power": {image: "ghcr.io/groupsky/homy/modbus-serial:latest",
            environment: {COLLECTION: "main", SERVICE_NAME: "main-power", RAW_DIR: "/data/raw"},
            volumes: [{type: "bind", source: $raw, target: "/data/raw"}]},
        monitoring: {image: "ghcr.io/groupsky/homy/modbus-serial:latest",
            environment: {COLLECTION: "monitoring", SERVICE_NAME: "monitoring", RAW_DIR: "/data/raw"},
            volumes: [{type: "bind", source: $raw, target: "/data/raw"}]},
        solar: {image: "ghcr.io/groupsky/homy/modbus-serial:latest",
            environment: {COLLECTION: "monitoring", SERVICE_NAME: "solar", RAW_DIR: "/data/raw"},
            volumes: [{type: "bind", source: $raw, target: "/data/raw"}]},
        mongo: {image: "ghcr.io/groupsky/homy/mongo:latest"}
    }}' > "$MOCK_DIR/config.json"

    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/bin/bash
printf 'docker' >> "$MOCK_DIR/calls.log"
printf ' [%s]' "$@" >> "$MOCK_DIR/calls.log"
echo >> "$MOCK_DIR/calls.log"
if [ "$1" = "compose" ]; then
    case "$2" in
        version) echo "Docker Compose version v2.29.1" ;;
        config) cat "$MOCK_DIR/config.json" ;;
        exec)
            [ -e "$MOCK_DIR/fail-exec" ] && { echo "MongoServerError: Authentication failed." >&2; exit 1; }
            script="${*: -1}"
            collection=$(sed -n 's/.*getCollection("\([^"]*\)").*/\1/p' <<< "$script")
            cat "$MOCK_DIR/mongo.$collection" 2>/dev/null || true
            ;;
        *) exit 1 ;;
    esac
elif [ "$1" = "run" ]; then
    # docker run ... IMAGE node ARGS: run ARGS with the real node
    shift
    while [ $# -gt 0 ] && [ "$1" != "node" ]; do shift; done
    shift
    exec "$REAL_NODE" "$@"
else
    exit 1
fi
MOCK
    chmod +x "$MOCK_BIN/docker"
    export PATH="$MOCK_BIN:$PATH"
}

teardown() {
    teardown_test_env
}

reading() { # reading DEVICE OFFSET_MS POWER
    printf '{"_tz":%s,"_ms":10,"_addr":1,"_type":"sdm120","device":"%s","power":%s}\n' "$((START_MS + $2))" "$1" "$3"
}

@test "ndjson-overlap: equal streams print the table and exit 0" {
    reading main 1000 1 > "$RAW/main/$DAY.main-power.ndjson"
    reading main 1000 1 > "$MOCK_DIR/mongo.main"
    reading pump 1000 2 > "$RAW/monitoring/$DAY.monitoring.ndjson"
    reading solar 2000 3 > "$RAW/monitoring/$DAY.solar.ndjson"
    { reading solar 2000 3; reading pump 1000 2; } > "$MOCK_DIR/mongo.monitoring"

    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" "$DAY"

    assert_success
    assert_line --index 0 '| stream | UTC day | Mongo | NDJSON | equal | notes |'
    assert_line '| main | 2026-01-15 | 1 | 1 | yes |  |'
    assert_line '| monitoring | 2026-01-15 | 2 | 2 | yes | monitoring 1 + solar 1 |'
    # mongosh runs in the mongo container, against the app database, as root
    run grep -c 'docker \[compose\] \[exec\] \[-T\] \[mongo\] \[sh\] \[-c\] \[exec mongosh .*--authenticationDatabase admin .*"\$MONGO_INITDB_DATABASE" --eval "\$1"\] \[mongosh\]' "$MOCK_DIR/calls.log"
    assert_output 2
}

@test "ndjson-overlap: a difference exits 1" {
    reading main 1000 1 > "$RAW/main/$DAY.main-power.ndjson"
    { reading main 1000 1; reading main 2000 1; } > "$MOCK_DIR/mongo.main"

    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream main "$DAY"

    assert_failure 1
    assert_line '| main | 2026-01-15 | 2 | 1 | **no**: 1 only in Mongo, 0 only in NDJSON |  |'
}

@test "ndjson-overlap: --results adds each run to the table" {
    reading main 1000 1 > "$RAW/main/$DAY.main-power.ndjson"
    reading main 1000 1 > "$MOCK_DIR/mongo.main"
    cd "$TEST_DIR"

    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream main --results overlap.jsonl "$DAY"
    assert_success
    : > "$MOCK_DIR/mongo.main"
    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream main --results overlap.jsonl 2026-01-16

    assert_success
    assert_line '| main | 2026-01-15 | 1 | 1 | yes |  |'
    assert_line '| main | 2026-01-16 | 0 | 0 | yes | main-power: no file |'
    [ "$(wc -l < "$TEST_DIR/overlap.jsonl")" -eq 2 ]
}

@test "ndjson-overlap: a failed Mongo query exits 2 and records nothing" {
    reading main 1000 1 > "$RAW/main/$DAY.main-power.ndjson"
    touch "$MOCK_DIR/fail-exec"

    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream main --results "$TEST_DIR/overlap.jsonl" "$DAY"

    assert_failure 2
    [ ! -s "$TEST_DIR/overlap.jsonl" ]
}

@test "ndjson-overlap: a results file that cannot be written exits 2 before any query" {
    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream main --results "$TEST_DIR/no/such/dir/overlap.jsonl" "$DAY"

    assert_failure 2
    [[ "$stderr" == *"Cannot write the results file"* ]]
    run grep -c '\[exec\]' "$MOCK_DIR/calls.log"
    assert_output 0
}

@test "ndjson-overlap: an unknown stream exits 2 and names the known ones" {
    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream nope "$DAY"

    assert_failure 2
    [[ "$stderr" == *"no NDJSON writer for stream \"nope\"; there are: main, monitoring"* ]]
}

@test "ndjson-overlap: without a usable host Node it runs in the node image, raw directory read-only" {
    printf '#!/bin/sh\necho 12\n' > "$MOCK_BIN/node"
    chmod +x "$MOCK_BIN/node"
    reading main 1000 1 > "$RAW/main/$DAY.main-power.ndjson"
    reading main 1000 1 > "$MOCK_DIR/mongo.main"

    run --separate-stderr "$PROJECT_DIR/scripts/ndjson-overlap.sh" --stream main "$DAY"

    assert_success
    assert_line '| main | 2026-01-15 | 1 | 1 | yes |  |'
    run grep -cF -- "[--network] [none] [--user] [$(id -u):$(id -g)] [-v] [$PROJECT_DIR/scripts/ndjson-overlap:$PROJECT_DIR/scripts/ndjson-overlap:ro] [-v] [$RAW:$RAW:ro] [ghcr.io/groupsky/homy/node:22.22.0-alpine3.23] [node] [$PROJECT_DIR/scripts/ndjson-overlap/index.mjs] [compare]" "$MOCK_DIR/calls.log"
    assert_output 1
}
