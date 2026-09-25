#!/usr/bin/env bash
#
# A fake docker CLI (and zfs, git) backed by files, for testing the deploy
# flow without docker. Load after test_helper and call setup_mock_stack.
#
# $MOCK_DIR holds the state:
#   config.json         `docker compose config --format json`
#   hashes              `docker compose config --hash '*'`
#   containers.json     array of `docker inspect` objects for the project
#   images.json         array of `docker image inspect` objects
#   up.N.jq             jq program applied to containers.json by the N-th `compose up`
#   up.N.sh             script run by the N-th `compose up` (after up.N.jq)
#   up.N.fail           the N-th `compose up` exits 1 (after applying up.N.jq)
#   inspect-budget      `docker inspect` succeeds this many more times, then fails
#   inspect.jq          jq filter applied to what `docker inspect` returns,
#                       with $now = the fake clock (file clock)
#   fail-<subcommand>   `docker compose <subcommand>` exits 1
#   fail-inspect        `docker inspect` exits 1
#   fail-config-hash    `docker compose config --hash` exits 1
#   stop-noop           `docker compose stop` leaves the containers running
#   calls.log           every docker call, prefixed with COMPOSE_FILE and IMAGE_TAG
#   zfs/...             see install_mock_zfs
#

setup_mock_stack() {
    export MOCK_DIR="$TEST_DIR/mock"
    export MOCK_BIN="$TEST_DIR/mockbin"
    mkdir -p "$MOCK_DIR" "$MOCK_BIN"
    echo 0 > "$MOCK_DIR/clock"
    echo '[]' > "$MOCK_DIR/containers.json"
    echo '[]' > "$MOCK_DIR/images.json"
    : > "$MOCK_DIR/calls.log"
    : > "$MOCK_DIR/hashes"
    install_mock_docker
    export PATH="$MOCK_BIN:$PATH"
}

install_mock_docker() {
    cat > "$MOCK_BIN/docker" <<'MOCK'
#!/bin/bash
echo "COMPOSE_FILE=${COMPOSE_FILE:-} IMAGE_TAG=${IMAGE_TAG:-} docker $*" >> "$MOCK_DIR/calls.log"
C="$MOCK_DIR/containers.json"

if [ "$1" = "compose" ]; then
    shift
    sub="$1"
    shift
    if [ -e "$MOCK_DIR/fail-$sub" ]; then
        echo "mock: docker compose $sub failed" >&2
        exit 1
    fi
    case "$sub" in
        version)
            echo "${MOCK_COMPOSE_VERSION:-2.29.1}"
            ;;
        config)
            if [[ " $* " == *" --hash "* ]]; then
                [ -e "$MOCK_DIR/fail-config-hash" ] && exit 1
                cat "$MOCK_DIR/hashes"
            else
                cat "$MOCK_DIR/config.json"
            fi
            ;;
        pull)
            echo "mock: pulled"
            ;;
        ps)
            all=0
            svc=""
            for a in "$@"; do
                case "$a" in
                    -a|--all) all=1 ;;
                    -*) ;;
                    *) svc="$a" ;;
                esac
            done
            jq -r --arg s "$svc" --argjson all "$all" '.[]
                | select($s == "" or .Config.Labels["com.docker.compose.service"] == $s)
                | select($all == 1 or .State.Status == "running")
                | .Id' "$C"
            ;;
        up)
            n=$(( $(cat "$MOCK_DIR/up-count" 2>/dev/null || echo 0) + 1 ))
            echo "$n" > "$MOCK_DIR/up-count"
            if [ -f "$MOCK_DIR/up.$n.jq" ]; then
                jq -f "$MOCK_DIR/up.$n.jq" "$C" > "$C.tmp" && mv "$C.tmp" "$C"
            fi
            if [ -f "$MOCK_DIR/up.$n.sh" ]; then
                bash "$MOCK_DIR/up.$n.sh"
            fi
            if [ -e "$MOCK_DIR/up.$n.fail" ]; then
                echo "mock: up failed" >&2
                exit 1
            fi
            ;;
        stop|start)
            [ "$sub" = stop ] && [ -e "$MOCK_DIR/stop-noop" ] && exit 0
            want=$([ "$sub" = stop ] && echo exited || echo running)
            jq --arg st "$want" --args '
                ($ARGS.positional) as $svcs
                | map(if ($svcs | length) == 0 or ((.Config.Labels["com.docker.compose.service"]) as $s | $svcs | index($s))
                      then .State.Status = $st | .State.Running = ($st == "running") else . end)' "$@" < "$C" > "$C.tmp" && mv "$C.tmp" "$C"
            ;;
    esac
    exit 0
fi

case "$1" in
    inspect)
        shift
        if [ -e "$MOCK_DIR/fail-inspect" ]; then
            echo "Error: mock inspect failure" >&2
            exit 1
        fi
        if [ -f "$MOCK_DIR/inspect-budget" ]; then
            left=$(cat "$MOCK_DIR/inspect-budget")
            if [ "$left" -le 0 ]; then
                echo "Error: mock inspect failure" >&2
                exit 1
            fi
            echo $((left - 1)) > "$MOCK_DIR/inspect-budget"
        fi
        now=$(cat "$MOCK_DIR/clock")
        filter='.'
        [ -f "$MOCK_DIR/inspect.jq" ] && filter=$(cat "$MOCK_DIR/inspect.jq")
        out=$(jq --argjson now "$now" --args "[.[] | select(.Id as \$i | \$ARGS.positional | index(\$i))] | map($filter)" "$@" < "$C")
        if [ "$(jq length <<<"$out")" -ne "$#" ]; then
            echo "Error: No such object" >&2
            exit 1
        fi
        echo "$out"
        ;;
    image)
        shift
        [ "$1" = "inspect" ] || exit 1
        shift
        fmt=""
        if [ "$1" = "--format" ]; then fmt="$2"; shift 2; fi
        img=$(jq -c --arg i "$1" '.[] | select((.RepoTags // []) | index($i))' "$MOCK_DIR/images.json" | head -n1)
        if [ -z "$img" ]; then
            echo "Error: No such image: $1" >&2
            exit 1
        fi
        if [ "$fmt" = '{{json .RepoDigests}}' ]; then
            jq -c '.RepoDigests' <<<"$img"
        else
            echo "[$img]"
        fi
        ;;
esac
exit 0
MOCK
    chmod +x "$MOCK_BIN/docker"
}

# Fake zfs. $MOCK_DIR/zfs/datasets has "path-prefix<TAB>dataset" lines (the
# longest matching prefix wins); $MOCK_DIR/zfs/avail is the pool's free bytes;
# $MOCK_DIR/zfs/mountpoint the dataset's mountpoint; fail-snapshot makes
# `zfs snapshot` fail; snapshots taken are listed in $MOCK_DIR/zfs/snapshots.
install_mock_zfs() {
    mkdir -p "$MOCK_DIR/zfs"
    : > "$MOCK_DIR/zfs/datasets"
    : > "$MOCK_DIR/zfs/snapshots"
    echo $((100 * 1024 * 1024 * 1024)) > "$MOCK_DIR/zfs/avail"
    cat > "$MOCK_BIN/zfs" <<'MOCK'
#!/bin/bash
echo "zfs $*" >> "$MOCK_DIR/zfs/calls.log"
Z="$MOCK_DIR/zfs"
case "$1" in
    snapshot)
        [ -e "$Z/fail-snapshot" ] && { echo "cannot create snapshot: permission denied" >&2; exit 1; }
        [ -e "$Z/lose-snapshot" ] && exit 0
        echo "$2" >> "$Z/snapshots"
        ;;
    get)
        # zfs get -H -o value mountpoint <dataset>
        cat "$Z/mountpoint"
        ;;
    list)
        shift
        type=""; props=""; target=""
        while [ $# -gt 0 ]; do
            case "$1" in
                -H|-p) shift ;;
                -t) type="$2"; shift 2 ;;
                -o) props="$2"; shift 2 ;;
                -s) shift 2 ;;
                *) target="$1"; shift ;;
            esac
        done
        if [ "$type" = "snapshot" ]; then
            if [ -z "$target" ]; then
                while read -r s; do printf '%s\tThu Sep 25 10:00 2026\n' "$s"; done < "$Z/snapshots"
                exit 0
            fi
            grep -qxF "$target" "$Z/snapshots" || { echo "dataset does not exist" >&2; exit 1; }
            echo "$target"
            exit 0
        fi
        if [ "$props" = "avail" ]; then
            cat "$Z/avail"
            exit 0
        fi
        best=""; bestlen=0
        while IFS=$'\t' read -r prefix ds; do
            [ -n "$prefix" ] || continue
            case "$target" in
                "$prefix"|"$prefix"/*)
                    if [ ${#prefix} -gt $bestlen ]; then best="$ds"; bestlen=${#prefix}; fi ;;
            esac
        done < "$Z/datasets"
        [ -n "$best" ] || { echo "cannot open '$target': not a ZFS filesystem" >&2; exit 1; }
        echo "$best"
        ;;
esac
exit 0
MOCK
    chmod +x "$MOCK_BIN/zfs"
}

# A docker inspect object for a compose container.
# Usage: mock_container <service> <id> <image id> [status] [health] [restart policy] [started]
mock_container() {
    local svc="$1" id="$2" image="$3" status="${4:-running}" health="${5:-}" policy="${6:-unless-stopped}" started="${7:-2026-09-25T10:00:00Z}"
    jq -n --arg s "$svc" --arg id "$id" --arg img "$image" --arg st "$status" --arg h "$health" --arg p "$policy" --arg t "$started" '{
        Id: $id, Name: ("/homy-" + $s + "-1"), Image: $img, RestartCount: 0,
        Config: {
            Labels: {"com.docker.compose.service": $s, "com.docker.compose.config-hash": ("hash-" + $s)},
            Healthcheck: (if $h == "" then null else {Test: ["CMD", "true"], StartPeriod: 0, Interval: 0, Retries: 0, Timeout: 0} end)
        },
        HostConfig: {RestartPolicy: {Name: $p}},
        State: ({Status: $st, Running: ($st == "running"), StartedAt: $t}
                + (if $h == "" then {} else {Health: {Status: $h}} end)),
        Mounts: []
    }'
}

# Write containers.json from mock_container outputs given on stdin
mock_containers() {
    jq -s '.' > "$MOCK_DIR/containers.json"
}
