#!/bin/ash
# The broker reads its password file as user mosquitto and stops when it
# cannot. The deployed file (in a read-only secrets folder) may be owned by
# another user, or missing. So copy it to a place the broker owns; when it
# is missing, use an empty file: the broker starts and nobody can log in on
# the login-only listener.
set -e
src=/mosquitto/secrets/passwd
dst=/mosquitto/auth/passwd
mkdir -p /mosquitto/auth
if [ -f "$src" ]; then
  cp "$src" "$dst"
else
  echo "entrypoint: no $src, the login-only listener has no users" >&2
  : > "$dst"
fi
chown -R mosquitto:mosquitto /mosquitto/auth
chmod 0700 /mosquitto/auth
chmod 0600 "$dst"
exec /docker-entrypoint.sh "$@"
