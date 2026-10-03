#!/usr/bin/env bash
# Recreate the local test database and apply shim + every migration in order.
set -euo pipefail
PGURL_ADMIN=${PGURL_ADMIN:-"postgresql://postgres@localhost:54329/postgres?host=/tmp"}
DB=${DB:-dilly_test}
psql "$PGURL_ADMIN" -qc "drop database if exists $DB" -c "create database $DB"
URL="postgresql://postgres@localhost:54329/$DB?host=/tmp"
psql "$URL" -q -v ON_ERROR_STOP=1 -f scripts/local/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" || { echo "FAILED: $f"; exit 1; }
done
echo "migrated $DB"
