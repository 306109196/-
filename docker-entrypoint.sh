#!/bin/sh
set -eu

DATA_PATH="${DATA_DIR:-/var/data}"
mkdir -p "$DATA_PATH"

if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_PATH"
  exec su-exec node "$@"
fi

exec "$@"
