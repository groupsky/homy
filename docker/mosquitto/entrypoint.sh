#!/bin/ash
# The broker reads its password file as user mosquitto and stops when it
# cannot. The deployed file (in a read-only secrets folder) may be owned by
# another user, or missing. So copy each file to a place the broker owns; when it
# is missing, use an empty file: the broker starts and nobody can log in on
# the login-only listener.
set -e
mkdir -p /mosquitto/auth
# passwd: port 1884 (the car). servers.passwd: port 1885 (#1964).
for name in passwd servers.passwd; do
  src=/mosquitto/secrets/$name
  dst=/mosquitto/auth/$name
  if [ -f "$src" ]; then
    cp "$src" "$dst"
  else
    echo "entrypoint: no $src, its login-only listener has no users" >&2
    : > "$dst"
  fi
  chmod 0600 "$dst"
done
chown -R mosquitto:mosquitto /mosquitto/auth
chmod 0700 /mosquitto/auth
exec /docker-entrypoint.sh "$@"
