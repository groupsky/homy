#!/usr/bin/env bats
#
# Changed-service selection (#1607): the deploy pins every service to its
# image digest and labels it with a hash of the host config files it mounts,
# so compose recreates a service only when its image, its compose config or
# one of those files changed. These tests cover the override, the prediction
# log and the before/after comparison the health gate and rollback use.

load test_helper
load mock_stack

setup() {
    setup_test_env
    setup_mock_stack
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    CFG="$TEST_DIR/cfg"
    mkdir -p "$CFG/grafana/provisioning" "$TEST_DIR/data/grafana" "$TEST_DIR/secrets"
    echo "listener 1883" > "$CFG/broker.conf"
    echo "apiVersion: 1" > "$CFG/grafana/provisioning/datasources.yaml"
    echo "token-1" > "$TEST_DIR/secrets/telegram_bot_token"
    echo "data-1" > "$TEST_DIR/data/grafana/grafana.db"

    jq -n --arg cfg "$CFG" --arg data "$TEST_DIR/data" --arg sec "$TEST_DIR/secrets" '{
      services: {
        broker: {image: "ghcr.io/groupsky/homy/mosquitto:new", restart: "unless-stopped",
                 volumes: [{type: "bind", source: ($cfg + "/broker.conf"), target: "/mosquitto/config/mosquitto.conf", read_only: true}]},
        grafana: {image: "ghcr.io/groupsky/homy/grafana:new", restart: "unless-stopped",
                  labels: {"homy.stateful": "true"},
                  secrets: [{source: "telegram_bot_token", target: "telegram_bot_token"}],
                  volumes: [{type: "bind", source: ($cfg + "/grafana/provisioning"), target: "/etc/grafana/provisioning", read_only: true},
                            {type: "bind", source: ($data + "/grafana"), target: "/var/lib/grafana"},
                            {type: "bind", source: "/etc/localtime", target: "/etc/localtime", read_only: true}]},
        automations: {image: "ghcr.io/groupsky/homy/automations:new", restart: "unless-stopped"},
        features: {image: "ghcr.io/groupsky/homy/automations:new", restart: "unless-stopped"},
        volman: {image: "ghcr.io/groupsky/homy/volman:new", restart: "no"}
      },
      secrets: {telegram_bot_token: {file: ($sec + "/telegram_bot_token")}}
    }' > "$MOCK_DIR/config.json"

    cat > "$MOCK_DIR/images.json" <<'EOF'
[
  {"RepoTags": ["ghcr.io/groupsky/homy/mosquitto:new", "ghcr.io/groupsky/homy/mosquitto:old"],
   "RepoDigests": ["ghcr.io/groupsky/homy/mosquitto@sha256:aaaa"]},
  {"RepoTags": ["ghcr.io/groupsky/homy/grafana:new"],
   "RepoDigests": ["ghcr.io/groupsky/homy/grafana@sha256:bbbb"]},
  {"RepoTags": ["ghcr.io/groupsky/homy/automations:new"],
   "RepoDigests": ["mirror.example/automations@sha256:ffff", "ghcr.io/groupsky/homy/automations@sha256:cccc"]},
  {"RepoTags": ["ghcr.io/groupsky/homy/volman:new"], "RepoDigests": []}
]
EOF
}

teardown() {
    teardown_test_env
}

override() {
    generate_deploy_override "$MOCK_DIR/config.json" "$TEST_DIR/override.json"
}

label_of() {
    jq -r --arg s "$1" '.services[$s].labels["homy.config-files-hash"]' "$TEST_DIR/override.json"
}

# --- the digest override ---------------------------------------------------

@test "generate_deploy_override: pins every service to its registry digest" {
    run override
    assert_success

    assert_equal "$(jq -r '.services.broker.image' "$TEST_DIR/override.json")" "ghcr.io/groupsky/homy/mosquitto@sha256:aaaa"
    assert_equal "$(jq -r '.services.grafana.image' "$TEST_DIR/override.json")" "ghcr.io/groupsky/homy/grafana@sha256:bbbb"
    # the digest of the image's own repository, not a mirror's
    assert_equal "$(jq -r '.services.automations.image' "$TEST_DIR/override.json")" "ghcr.io/groupsky/homy/automations@sha256:cccc"
    assert_equal "$(jq -r '.services.features.image' "$TEST_DIR/override.json")" "ghcr.io/groupsky/homy/automations@sha256:cccc"
}

@test "generate_deploy_override: the same image under a new tag gets the same pin" {
    override
    first=$(jq -c '.services.broker' "$TEST_DIR/override.json")

    jq '.services.broker.image = "ghcr.io/groupsky/homy/mosquitto:old"' "$MOCK_DIR/config.json" > "$MOCK_DIR/c2" && mv "$MOCK_DIR/c2" "$MOCK_DIR/config.json"
    override

    assert_equal "$(jq -c '.services.broker' "$TEST_DIR/override.json")" "$first"
}

@test "generate_deploy_override: output is valid compose (JSON) with a label per service" {
    override
    run jq -r '.services | keys | join(" ")' "$TEST_DIR/override.json"
    assert_output "automations broker features grafana volman"
    for svc in automations broker features grafana volman; do
        [[ "$(label_of "$svc")" =~ ^[0-9a-f]{64}$ ]]
    done
    # no key compose would reject
    run jq -r 'keys | join(" ")' "$TEST_DIR/override.json"
    assert_output "services x-generated-by"
}

@test "generate_deploy_override: an image without a registry digest stays on its tag, with a warning" {
    run override
    assert_success
    assert_output --partial "WARNING: ghcr.io/groupsky/homy/volman:new has no registry digest"
    assert_equal "$(jq -r '.services.volman.image' "$TEST_DIR/override.json")" "ghcr.io/groupsky/homy/volman:new"
}

@test "generate_deploy_override: a missing image fails before anything is written" {
    jq '.services.automations.image = "ghcr.io/groupsky/homy/automations:missing"' "$MOCK_DIR/config.json" > "$MOCK_DIR/c2" && mv "$MOCK_DIR/c2" "$MOCK_DIR/config.json"

    run override
    assert_failure
    assert_output --partial "Image ghcr.io/groupsky/homy/automations:missing is not on this host"
    [ ! -e "$TEST_DIR/override.json" ]
}

# --- the config-files hash ---------------------------------------------------

@test "config hash: unchanged files give the same hash" {
    override
    before=$(label_of broker)
    override
    assert_equal "$(label_of broker)" "$before"
}

@test "config hash: editing a mounted config file changes only that service" {
    override
    broker=$(label_of broker)
    grafana=$(label_of grafana)
    automations=$(label_of automations)

    echo "listener 1884" > "$CFG/broker.conf"
    override

    [ "$(label_of broker)" != "$broker" ]
    assert_equal "$(label_of grafana)" "$grafana"
    assert_equal "$(label_of automations)" "$automations"
}

@test "config hash: a new file in a mounted config directory changes the hash" {
    override
    before=$(label_of grafana)
    echo "x" > "$CFG/grafana/provisioning/alerting.yaml"
    override
    [ "$(label_of grafana)" != "$before" ]
}

@test "config hash: a changed secret file changes the hash" {
    override
    before=$(label_of grafana)
    echo "token-2" > "$TEST_DIR/secrets/telegram_bot_token"
    override
    [ "$(label_of grafana)" != "$before" ]
}

@test "config hash: data written to a writable mount does not change the hash" {
    override
    before=$(label_of grafana)
    echo "data-2" > "$TEST_DIR/data/grafana/grafana.db"
    echo "more" > "$TEST_DIR/data/grafana/new.db"
    override
    assert_equal "$(label_of grafana)" "$before"
}

@test "config hash: a read-only mount of another service's data is not config" {
    # ingress reads the nginx config ingressgen writes (container addresses in it)
    mkdir -p "$TEST_DIR/data/ingress"
    echo "server 1" > "$TEST_DIR/data/ingress/default.conf"
    jq --arg d "$TEST_DIR/data/ingress" '.services.ingress = {image: "ghcr.io/groupsky/homy/mosquitto:new", restart: "on-failure",
          volumes: [{type: "bind", source: $d, target: "/etc/nginx/conf.d", read_only: true}]}
        | .services.ingressgen = {image: "ghcr.io/groupsky/homy/mosquitto:new", restart: "unless-stopped",
          volumes: [{type: "bind", source: $d, target: "/etc/nginx/conf.d"}]}' "$MOCK_DIR/config.json" > "$MOCK_DIR/c2"
    mv "$MOCK_DIR/c2" "$MOCK_DIR/config.json"

    override
    before=$(label_of ingress)
    echo "server 2" > "$TEST_DIR/data/ingress/default.conf"
    override
    assert_equal "$(label_of ingress)" "$before"
}

@test "config hash: the same path mounted by several services gives the same result with the cache" {
    jq --arg c "$CFG" '.services.automations.volumes = [{type: "bind", source: ($c + "/grafana/provisioning"), target: "/x", read_only: true}]
        | .services.features.volumes = [{type: "bind", source: ($c + "/grafana/provisioning"), target: "/x", read_only: true}]' \
        "$MOCK_DIR/config.json" > "$MOCK_DIR/c2"
    mv "$MOCK_DIR/c2" "$MOCK_DIR/config.json"

    override
    assert_equal "$(label_of automations)" "$(label_of features)"
    assert_equal "$(label_of automations)" "$(service_config_files_hash "$MOCK_DIR/config.json" automations)"
}

@test "config hash: an unreadable config directory is warned about, not fatal" {
    if [ "$(id -u)" -eq 0 ]; then
        skip "root reads every file"
    fi
    mkdir -p "$CFG/grafana/provisioning/secret"
    chmod 000 "$CFG/grafana/provisioning/secret"
    run override
    chmod 755 "$CFG/grafana/provisioning/secret"
    assert_success
    assert_output --partial "WARNING: cannot read $CFG/grafana/provisioning/secret"
}

@test "config hash: an unreadable config file is warned about, not fatal" {
    if [ "$(id -u)" -eq 0 ]; then
        skip "root reads every file"
    fi
    chmod 000 "$CFG/broker.conf"
    run override
    chmod 644 "$CFG/broker.conf"
    assert_success
    assert_output --partial "WARNING: cannot read $CFG/broker.conf"
}

# --- which compose files -------------------------------------------------------

@test "compose_base_files: docker-compose.yml, plus the host's override file" {
    unset COMPOSE_FILE
    assert_equal "$(compose_base_files)" "$PROJECT_DIR/docker-compose.yml"
    touch "$PROJECT_DIR/docker-compose.override.yml"
    assert_equal "$(compose_base_files)" "$PROJECT_DIR/docker-compose.yml:$PROJECT_DIR/docker-compose.override.yml"
}

@test "compose_base_files: follows COMPOSE_FILE from .env, without the deploy override" {
    unset COMPOSE_FILE
    echo "COMPOSE_FILE=docker-compose.yml:extra.yml:docker-compose.deploy.yml" > "$PROJECT_DIR/.env"
    assert_equal "$(compose_base_files)" "$PROJECT_DIR/docker-compose.yml:$PROJECT_DIR/extra.yml"
}

# --- which services -----------------------------------------------------------

@test "long_running_services: leaves out one-shot (restart: no) services" {
    run long_running_services "$MOCK_DIR/config.json"
    assert_success
    assert_output "automations
broker
features
grafana"
}

@test "stateful_services: lists the services labelled homy.stateful" {
    run stateful_services "$MOCK_DIR/config.json"
    assert_output "grafana"
}

@test "predict_recreate: lists new services and those whose config hash differs" {
    {
        mock_container broker c-broker img-b
        mock_container automations c-auto img-a
    } | mock_containers
    # mock_container labels each container with config-hash "hash-<service>"
    printf 'automations hash-automations\nbroker hash-broker-NEW\ngrafana hash-grafana\n' > "$MOCK_DIR/hashes"
    touch "$DEPLOY_OVERRIDE_FILE"

    run predict_recreate automations broker grafana
    assert_success
    assert_output "broker
grafana"
    # the prediction uses the override on top of the committed file
    run grep -F "config --hash" "$MOCK_DIR/calls.log"
    assert_output --partial "docker-compose.yml:$DEPLOY_OVERRIDE_FILE"
}

@test "predict_recreate: nothing changed predicts nothing" {
    mock_container broker c-broker img-b | mock_containers
    echo 'broker hash-broker' > "$MOCK_DIR/hashes"

    run predict_recreate broker
    assert_success
    assert_output ""
}

# --- what actually changed ------------------------------------------------------

write_states() {
    printf '%s\n' "$@" | tr '|' '\t' > "$TEST_DIR/$STATE_FILE"
}

@test "changed_services: replaced, newly started or new containers; not self-restarts" {
    STATE_FILE=before write_states \
        "automations|c1|img-a|2026-09-25T10:00:00Z|running" \
        "broker|c2|img-b|2026-09-25T10:00:00Z|running" \
        "grafana|c3|img-g|2026-09-25T10:00:00Z|running" \
        "ha|c4|img-h|2026-09-25T10:00:00Z|running" \
        "mongo|c6|img-m|2026-09-25T09:00:00Z|exited"
    STATE_FILE=after write_states \
        "automations|c1|img-a|2026-09-25T10:00:00Z|running" \
        "broker|c9|img-b2|2026-09-25T11:00:00Z|running" \
        "grafana|c3|img-g|2026-09-25T11:00:00Z|running" \
        "ha|c4|img-h|2026-09-25T10:00:00Z|running" \
        "mongo|c6|img-m|2026-09-25T11:00:00Z|running" \
        "newsvc|c5|img-n|2026-09-25T11:00:00Z|running"

    run changed_services "$TEST_DIR/before" "$TEST_DIR/after"
    # grafana restarted by itself (same container, was running): not the deploy's doing
    assert_output "broker
mongo
newsvc"
}

@test "changed_services: nothing changed lists nothing" {
    STATE_FILE=before write_states "automations|c1|img-a|2026-09-25T10:00:00Z|running"
    cp "$TEST_DIR/before" "$TEST_DIR/after"

    run changed_services "$TEST_DIR/before" "$TEST_DIR/after"
    assert_output ""
}

@test "changed_services: with no containers before, everything is new" {
    : > "$TEST_DIR/before"
    STATE_FILE=after write_states \
        "automations|c1|img-a|2026-09-25T10:00:00Z|running" \
        "broker|c2|img-b|2026-09-25T10:00:00Z|running"

    run changed_services "$TEST_DIR/before" "$TEST_DIR/after"
    assert_output "automations
broker"
}

@test "image_changed_services: a config-only recreate is not an image change" {
    STATE_FILE=before write_states \
        "broker|c2|img-b|2026-09-25T10:00:00Z|running" \
        "ha|c4|img-h|2026-09-25T10:00:00Z|running"
    STATE_FILE=after write_states \
        "broker|c9|img-b|2026-09-25T11:00:00Z|running" \
        "ha|c8|img-h2|2026-09-25T11:00:00Z|running"

    run image_changed_services "$TEST_DIR/before" "$TEST_DIR/after"
    assert_output "ha"
}

@test "container_states: one tab-separated line per container" {
    {
        mock_container broker c-broker img-b running "" unless-stopped 2026-09-25T10:00:00Z
        mock_container automations c-auto img-a exited
    } | mock_containers

    run container_states
    assert_success
    assert_line --index 0 "$(printf 'automations\tc-auto\timg-a\t2026-09-25T10:00:00Z\texited')"
    assert_line --index 1 "$(printf 'broker\tc-broker\timg-b\t2026-09-25T10:00:00Z\trunning')"
}
