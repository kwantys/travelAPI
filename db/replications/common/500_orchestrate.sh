#!/usr/bin/env bash
set -euo pipefail

run_sql_dir() {
  local dir="$1"
  [ -d "$dir" ] || return 0
  # Спочатку *.sql за абеткою, потім *.sh — це дає стабільний і передбачуваний порядок
  find "$dir" -maxdepth 1 -type f -name "*.sql" | sort | while read -r f; do
    echo "Applying SQL: $f"
    psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$f"
  done
  find "$dir" -maxdepth 1 -type f -name "*.sh" | sort | while read -r f; do
    echo "Running SH: $f"
    bash "$f"
  done
}

run_sql_dir "/docker-entrypoint-migrations"
run_sql_dir "/docker-entrypoint-replications"