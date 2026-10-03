# shellcheck shell=bash
# Shared helpers for the Dilly V2 -> Dilly migration scripts. Sourced, never executed.
#
# Safety model:
#   * V2 (the old Supabase project) is only ever opened read-only: every psql session against it
#     starts with `set session characteristics as transaction read only`, and pg_dump is read-only by design.
#   * NEW (the new Dilly project) is only written through the `legacy`, `legacy_v` and `migration`
#     schemas plus the idempotent transforms into public.*.
#   * Anything destructive needs an explicit flag (--yes).

MIGRATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$MIGRATION_DIR/.." && pwd)"
OUT_ROOT="${OUT_ROOT:-$MIGRATION_DIR/out}"

log()  { printf '[migration %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
warn() { printf '[migration %s] WARNING: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die()  { printf '[migration %s] ERROR: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

need_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "environment variable $name is required"
}

# Strip credentials from a URL before printing it.
redact() { printf '%s' "$1" | sed -E 's#(://[^:/@]+):[^@]*@#\1:***@#'; }

# psql against V2: read-only session, stop on first error, no ~/.psqlrc.
v2_psql() {
  psql "$V2_DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "set session characteristics as transaction read only" "$@"
}

# psql against NEW.
new_psql() {
  psql "$NEW_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"
}

# Physical identity of the server+database behind a URL (host/socket, port, database name).
db_identity() {
  psql "$1" -X -A -t -q -c \
    "select coalesce(host(inet_server_addr()), 'socket:' || coalesce(current_setting('unix_socket_directories', true), '?'))
            || ':' || current_setting('port') || '/' || current_database()"
}

# True (0) when the database behind the URL is a NEW Dilly database (has the app.reconcile_tasks rule).
looks_like_new_dilly() {
  local r
  r="$(psql "$1" -X -A -t -q -c "select to_regprocedure('app.reconcile_tasks(uuid)') is not null")"
  [[ "$r" == "t" ]]
}

# Refuse to run when V2_DB_URL actually points at the NEW project.
guard_v2_is_not_new() {
  need_env V2_DB_URL
  if [[ -n "${NEW_DB_URL:-}" && "$V2_DB_URL" == "$NEW_DB_URL" ]]; then
    die "V2_DB_URL is identical to NEW_DB_URL — refusing to run"
  fi
  local v2id newid
  v2id="$(db_identity "$V2_DB_URL")" || die "cannot connect to V2_DB_URL ($(redact "$V2_DB_URL"))"
  if [[ -n "${NEW_DB_URL:-}" ]]; then
    newid="$(db_identity "$NEW_DB_URL")" || die "cannot connect to NEW_DB_URL ($(redact "$NEW_DB_URL"))"
    [[ "$v2id" != "$newid" ]] || die "V2_DB_URL and NEW_DB_URL resolve to the same database ($v2id) — refusing to run"
  fi
  if looks_like_new_dilly "$V2_DB_URL"; then
    die "V2_DB_URL points at a database that has the NEW Dilly schema (app.reconcile_tasks) — refusing to run"
  fi
  log "V2 database: $v2id (read-only session)"
}

# Refuse to write to NEW unless it really is a NEW Dilly database (and not V2).
guard_new_is_new() {
  need_env NEW_DB_URL
  looks_like_new_dilly "$NEW_DB_URL" || die "NEW_DB_URL does not have the new Dilly schema (app.reconcile_tasks missing) — refusing to write"
  if [[ -n "${V2_DB_URL:-}" ]]; then
    [[ "$(db_identity "$V2_DB_URL")" != "$(db_identity "$NEW_DB_URL")" ]] || die "NEW_DB_URL and V2_DB_URL are the same database"
  fi
  log "NEW database: $(db_identity "$NEW_DB_URL")"
}

# Resolve a dump directory: explicit argument, else $OUT_ROOT/latest.
resolve_dump_dir() {
  local d="${1:-}"
  if [[ -z "$d" ]]; then
    [[ -e "$OUT_ROOT/latest" ]] || die "no dump found: run migration/01-dump.sh first or pass --dir"
    d="$(cd "$OUT_ROOT/latest" && pwd -P)"
  fi
  [[ -d "$d" ]] || die "dump directory not found: $d"
  printf '%s' "$d"
}

verify_manifest() {
  local d="$1"
  [[ -f "$d/MANIFEST.sha256" ]] || die "missing $d/MANIFEST.sha256"
  log "verifying checksums in $d/MANIFEST.sha256"
  (cd "$d" && sha256sum --quiet -c MANIFEST.sha256) || die "checksum mismatch in $d — the dump was modified or is incomplete"
}

# SQL listing "table<TAB>exact count" for every table in a schema (tables starting with _ are bookkeeping, skipped).
exact_counts_sql() {
  cat <<SQL
select c.relname,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = '$1' and c.relkind in ('r','p') and c.relname !~ '^_'
 order by 1
SQL
}

# Replace the database name in a postgres URL (keeps credentials, host, port and query parameters).
url_with_db() {
  local url="$1" db="$2"
  [[ "$url" =~ ^postgres(ql)?://[^/]*/ ]] || die "URL must contain a /database path: $(redact "$url")"
  printf '%s' "$url" | sed -E "s#^(postgres(ql)?://[^/]*)/[^?]*#\\1/$db#"
}
