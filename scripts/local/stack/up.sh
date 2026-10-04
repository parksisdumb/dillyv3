#!/usr/bin/env bash
# Local Supabase-equivalent: Postgres (already running on :54329) + Auth + PostgREST + gateway on :54321.
# Usage: scripts/local/stack/up.sh [--fresh]
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
BIN=${STACK_BIN:-"$HOME/.dilly-stack"}
DB=${STACK_DB:-dilly_e2e}
LOG=${STACK_LOG:-/tmp/dilly-stack}
mkdir -p "$LOG"
ADMIN="postgresql://postgres@localhost:54329/postgres?host=/tmp"
URL="postgresql://postgres@localhost:54329/$DB?host=/tmp"
SECRET=$(node -e 'import("'"$ROOT"'/scripts/local/stack/keys.mjs").then(m=>console.log(m.JWT_SECRET))')

for svc in auth postgrest gateway; do
  [ -f "$LOG/$svc.pid" ] && kill "$(cat "$LOG/$svc.pid")" 2>/dev/null || true
done

if [ "${1:-}" = "--fresh" ] || ! psql "$ADMIN" -Atc "select 1 from pg_database where datname='$DB'" | grep -q 1; then
  echo "== creating $DB"
  psql "$ADMIN" -qc "drop database if exists $DB" -c "create database $DB"
  psql "$URL" -q -v ON_ERROR_STOP=1 <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login password 'authenticator' noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin login password 'auth' createrole; end if;
end \$\$;
grant anon, authenticated, service_role to authenticator;
create schema if not exists auth authorization supabase_auth_admin;
grant create on database $DB to supabase_auth_admin;
alter role supabase_auth_admin set search_path = auth;
SQL
  echo "== auth migrations"
  ( cd "$BIN" && GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:auth@localhost:54329/$DB?host=/tmp&sslmode=disable" \
    GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_SITE_URL=http://localhost:3000 \
    GOTRUE_JWT_SECRET="$SECRET" ./auth migrate ) > "$LOG/auth-migrate.log" 2>&1 || { tail -30 "$LOG/auth-migrate.log"; exit 1; }
  psql "$URL" -q -c "grant usage on schema auth to anon, authenticated, service_role; grant select on auth.users to service_role;"
  echo "== app migrations"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql "$URL" -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null || { echo "FAILED: $f"; exit 1; }
  done
fi

echo "== starting auth (:9999)"
( cd "$BIN" && GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:auth@localhost:54329/$DB?host=/tmp&sslmode=disable" \
  GOTRUE_DB_MIGRATIONS_PATH="$BIN/migrations" GOTRUE_API_HOST=127.0.0.1 PORT=9999 API_EXTERNAL_URL=http://localhost:54321/auth/v1 \
  GOTRUE_SITE_URL=http://localhost:3000 GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**" GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 \
  GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
  GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false \
  GOTRUE_RATE_LIMIT_HEADER="" GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_LOG_LEVEL=warn \
  nohup ./auth serve > "$LOG/auth.log" 2>&1 & echo $! > "$LOG/auth.pid" )

echo "== starting PostgREST (:3001)"
cat > "$LOG/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:authenticator@localhost:54329/$DB?host=/tmp"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRET"
server-port = 3001
server-host = "127.0.0.1"
db-pool = 20
CONF
nohup "$BIN/postgrest" "$LOG/postgrest.conf" > "$LOG/postgrest.log" 2>&1 &
echo $! > "$LOG/postgrest.pid"

echo "== starting gateway (:54321)"
nohup node "$ROOT/scripts/local/stack/gateway.mjs" > "$LOG/gateway.log" 2>&1 &
echo $! > "$LOG/gateway.pid"

for i in $(seq 1 40); do
  curl -sf http://127.0.0.1:54321/auth/v1/health >/dev/null 2>&1 && break
  sleep 0.5
done
node "$ROOT/scripts/local/stack/keys.mjs" > "$LOG/keys.env"
echo "stack up — NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 ; keys in $LOG/keys.env"
