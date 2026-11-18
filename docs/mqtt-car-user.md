# The car-only MQTT user

The car app keeps its MQTT user name and password in plain text on its
device. So the user it holds may do very little (#1962).

## Two listeners

The broker (`config/mosquitto/broker.conf`) has two listeners, each with its
own settings (`per_listener_settings true`):

| Port | Login | Rights | Used by |
|---|---|---|---|
| 1883 | none (anonymous) | everything | every service on the docker networks (`broker:1883`), and the clients that use the published port today |
| 1884 | required | only what `config/mosquitto/car.acl` gives | the car app |

Both ports are published on routy. Port 1883 stays anonymous: other clients
use the published port without a login today, so a login there would stop
them. Closing 1883 to everything outside the docker networks is a later
step, after those clients have their own logins.

## What the car user may do (`car.acl`)

User `ioniq` (the user name the car app already sends):

- **read and write** `ioniq/#`: the car app's own topics. It publishes
  `ioniq/parsed/<group>`, `ioniq/raw/<group>`, `ioniq/log` and its
  will/status topic `ioniq/status`.
- **read only** `homy/ioniq/journeys`, `homy/ioniq/road_check` and
  `homy/ioniq/home`, which ev-journal publishes for the car.
- nothing else: no write to any `homy/ioniq/` topic, and no other topic.

A user on port 1884 that `car.acl` does not name may do nothing.

## The password file the deploy must provide

`${SECRETS_PATH}/mosquitto/passwd`, a mosquitto password file. It is never
in the repo. `docker-compose.yml` mounts the folder `${SECRETS_PATH}/mosquitto`
read-only, and `docker/mosquitto/entrypoint.sh` copies `passwd` to a place
the broker owns when the broker starts. When the file is missing, the broker
still starts with no users: port 1883 works, and nobody can log in on 1884.

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

To change the password, run the same command without `-c`, then restart the
broker. To remove the user: `mosquitto_passwd -D /out/passwd ioniq`.

## Test

`.github/scripts/test-mqtt-car-user/run.sh` (CI: `test-mqtt-car-user.yml`)
starts the real broker image with this config and checks each rule above.
