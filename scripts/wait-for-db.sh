#!/usr/bin/env bash
# scripts/wait-for-db.sh
# Waits for PostgreSQL to become ready before starting backend services.

set -e

TIMEOUT="${WAIT_FOR_DB_TIMEOUT:-30}"
HOST="${POSTGRES_HOST:-localhost}"
PORT="${POSTGRES_PORT:-5432}"
USER="${POSTGRES_USER:-postgres}"
DB="${POSTGRES_DB:-yieldvault}"

# Parse DATABASE_URL if host/port/user/db are default and DATABASE_URL is set
if [ -n "$DATABASE_URL" ]; then
  # Extract components from postgres://user:pass@host:port/dbname
  proto="$(echo "$DATABASE_URL" | grep :// | sed -e's,^\(.*://\).*,\1,g')"
  url="$(echo "${DATABASE_URL/$proto/}")"
  userpass="$(echo "$url" | grep @ | cut -d@ -f1)"
  hostportdb="$(echo "${url/$userpass@/}")"
  
  if [ -n "$userpass" ] && [ "$USER" = "postgres" ]; then
    USER="$(echo "$userpass" | cut -d: -f1)"
  fi
  
  hostport="$(echo "$hostportdb" | cut -d/ -f1)"
  if [ "$HOST" = "localhost" ] && [ -n "$hostport" ]; then
    parsed_host="$(echo "$hostport" | cut -d: -f1)"
    [ -n "$parsed_host" ] && HOST="$parsed_host"
  fi
  if [ "$PORT" = "5432" ] && echo "$hostport" | grep -q ":"; then
    parsed_port="$(echo "$hostport" | cut -d: -f2)"
    [ -n "$parsed_port" ] && PORT="$parsed_port"
  fi
  
  dbname="$(echo "$hostportdb" | grep / | cut -d/ -f2 | cut -d? -f1)"
  if [ "$DB" = "yieldvault" ] && [ -n "$dbname" ]; then
    DB="$dbname"
  fi
fi

echo "Waiting for PostgreSQL ($HOST:$PORT, db: $DB, user: $USER) to be ready (timeout: ${TIMEOUT}s)..."

elapsed=0
interval=1

is_db_ready() {
  # 1. Native pg_isready if installed locally
  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" >/dev/null 2>&1; then
      return 0
    fi
  fi

  # 2. Docker container check if pg_isready is in container
  if command -v docker >/dev/null 2>&1; then
    for container_name in yieldvault-postgres yieldvault-postgres-1 postgres; do
      if docker ps -q -f name="^/?${container_name}$" >/dev/null 2>&1 | grep -q .; then
        if docker exec "$container_name" pg_isready -U "$USER" -d "$DB" >/dev/null 2>&1; then
          return 0
        fi
      fi
    done
  fi

  # 3. Node.js TCP socket check fallback
  if command -v node >/dev/null 2>&1; then
    if node -e "
      const net = require('net');
      const socket = net.createConnection({ host: '$HOST', port: parseInt('$PORT', 10) }, () => {
        socket.end();
        process.exit(0);
      });
      socket.on('error', () => process.exit(1));
      setTimeout(() => process.exit(1), 1000);
    " >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}

while [ "$elapsed" -lt "$TIMEOUT" ]; do
  if is_db_ready; then
    echo "PostgreSQL is ready after ${elapsed}s!"
    exit 0
  fi

  sleep "$interval"
  elapsed=$((elapsed + interval))
  echo "Waiting for PostgreSQL... (${elapsed}/${TIMEOUT}s)"
done

echo "Error: Timed out waiting ${TIMEOUT}s for PostgreSQL to become ready at $HOST:$PORT (db: $DB, user: $USER)" >&2
exit 1
