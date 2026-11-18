# MQTT logins: the car user and the server users

The car app keeps its MQTT user name and password in plain text on its
device. So the user it holds may do very little (#1962).

## Three listeners

The broker (`config/mosquitto/broker.conf`) has three listeners, each with
its own settings (`per_listener_settings true`):

| Port | Login | Rights | Published on routy | Used by |
|---|---|---|---|---|
| 1883 | none (anonymous) | everything | on `127.0.0.1` only | every service on the docker networks (`broker:1883`), and tools on routy itself (`127.0.0.1:1883`) |
| 1884 | required, `passwd` | only what `config/mosquitto/car.acl` gives | yes | the car app |
| 1885 | required, `servers.passwd` | only what `config/mosquitto/servers.acl` gives | yes | the server clients outside docker (#1964) |

So no port that is open to the outside is anonymous (#1964).

On 1884 the broker uses the user name as the client id. On 1885 it does
not: the fleet checkers share one user and can run at the same time, each
with its own client id. The two password files are apart, so the car's
password does not work on 1885.

## The clients outside docker (#1964)

Found from the broker log of 2026-11-18 (connections that came in through
the published port 1883), grouped by client id, and from the code of each
client.

| Client id | User | Port to use | Publishes | Reads |
|---|---|---|---|---|
| `ioniq-logger` (the car app) | `ioniq` | 1884 | see `car.acl` | see `car.acl` |
| `fleet-<pid>` (the fleet checkers on the hosts other than routy) | `fleet-checker` | 1885 | `fleet/<host>/alert`, `fleet/<host>/influx`, `fleet/<host>/health` | nothing |
| `fleet-relay`, `fleet-relay-check` | `fleet-relay` | 1885, or `127.0.0.1:1883` on routy | nothing | `fleet/#` |
| `fleet-zigbee-availability-<pid>` | `fleet-zigbee-availability` | 1885, or `127.0.0.1:1883` on routy | nothing | `z2m/house1/#` |
| `fleet-media-volume` | `fleet-media-volume` | 1885 | `homy/media/living/volume/state` | `homy/media/living/volume/command` |
| `fleet-homeconnect-derived`, `fleet-homeconnect-derived-check` | `fleet-homeconnect-derived` | 1885, or `127.0.0.1:1883` on routy | `homeconnect/oven/derived/#` (with its will `homeconnect/oven/derived/status`), `homeassistant/sensor/homeconnect_oven_derived/#` | `homeconnect/oven/LWT`, two `homeconnect/oven/state/...` values, `/modbus/secondary/oven/reading` |
| `fleet-fully-metrics`, `fleet-fully-metrics-check` | `fleet-fully-metrics` | 1885, or `127.0.0.1:1883` on routy | nothing | `fully/#` |

The clients that run on routy itself may stay on `127.0.0.1:1883` without a
login, but only on the address `127.0.0.1`: routy's own name or tailnet
address no longer reaches 1883. Their users are there for when they move.
Client ids are shared by all listeners, so a client must not use the same id
on two ports at once (the second one pushes the first off). The others must move to
1884 or 1885 with a login: after the deploy, the outside cannot reach 1883.
A user on 1885 that `servers.acl` does not name may do nothing.

## What the car user may do (`car.acl`)

User `ioniq` (the user name the car app already sends):

- **read and write** the car app's own topics: `ioniq/parsed/#`,
  `ioniq/raw/#`, `ioniq/log` and its will/status topic `ioniq/status`. Not
  other `ioniq/` topics: `ioniq/derived/#` comes from the automations.
- **read only** `homy/ioniq/journeys`, `homy/ioniq/road_check` and
  `homy/ioniq/home`, which ev-journal publishes for the car.
- nothing else: no write to any `homy/ioniq/` topic, and no other topic.

On 1884 the broker uses the user name as the client id
(`use_username_as_clientid`), so the car cannot take the id of another client.

A user on port 1884 that `car.acl` does not name may do nothing.

## The password files the deploy must provide

`${SECRETS_PATH}/mosquitto/passwd` (port 1884: the user `ioniq`) and
`${SECRETS_PATH}/mosquitto/servers.passwd` (port 1885: the users in
`servers.acl`), mosquitto password files. They are never in the repo. `docker-compose.yml` mounts the folder `${SECRETS_PATH}/mosquitto`
read-only, and `docker/mosquitto/entrypoint.sh` copies each file to a place
the broker owns when the broker starts. When a file is missing, the broker
still starts: port 1883 works, and nobody can log in on that file's port.

## Add the car user

On routy, in the homy folder (`SECRETS_PATH` from `.env`):

```bash
mkdir -p "$SECRETS_PATH/mosquitto"
# Asks for the password twice. Run again with another user to add more;
# leave out -c then, or it makes a new file.
docker compose run --rm --no-deps -v "$SECRETS_PATH/mosquitto:/out" \
  --entrypoint mosquitto_passwd broker -c /out/passwd ioniq
docker compose restart broker
```

Then, in the car app's settings: port 1884, user `ioniq`, and the password.

A server user goes in `servers.passwd` the same way, for example
`... broker /out/servers.passwd fleet-relay` (add `-c` only for the first
user). The client then uses port 1885 with that user and password.

To change the password, run the same command without `-c`, then restart the
broker. To remove the user, then restart the broker:

```bash
docker compose run --rm --no-deps -v "$SECRETS_PATH/mosquitto:/out" \
  --entrypoint mosquitto_passwd broker -D /out/passwd ioniq
```

## Test

`.github/scripts/test-mqtt-car-user/run.sh` (CI: `test-mqtt-car-user.yml`)
starts the real broker image with this config and checks each rule above.
