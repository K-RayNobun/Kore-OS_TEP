#!/bin/sh
set -eu

GATEWAY_URL="${GATEWAY_URL:-http://localhost:3000}"
SOCK_PATH="/tmp/kore-os.sock"
DB_PATH="${KORE_DB_PATH:-/home/elo/data/tasks.db}"

check_http() {
  if command -v curl >/dev/null 2>&1; then
    curl -sf -o /dev/null "${GATEWAY_URL}/api/v1/telemetry"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O /dev/null "${GATEWAY_URL}/api/v1/telemetry"
  else
    echo "healthcheck: neither curl nor wget available"
    exit 1
  fi
}

check_socket() {
  if [ -S "${SOCK_PATH}" ]; then
    echo "healthcheck: unix socket present"
  else
    echo "healthcheck: unix socket missing"
    exit 1
  fi
}

check_db() {
  if [ -f "${DB_PATH}" ]; then
    echo "healthcheck: db present"
  else
    echo "healthcheck: db missing"
    exit 1
  fi
}

check_http
check_socket
check_db
echo "healthcheck: ok"
