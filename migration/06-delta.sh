#!/usr/bin/env bash
# 06-delta.sh — bring rows written in V2 after the last snapshot into NEW, then re-run transforms + reconcile.
#
#   V2_DB_URL=... NEW_DB_URL=... [LEGACY_ORG_ID=...] migration/06-delta.sh [--since <timestamptz>] --yes
#
# For every table in NEW `legacy`:
#   * rows whose created_at or updated_at is after the snapshot are copied from V2 (READ-ONLY session) into a
#     staging table; tables with neither column are copied whole and only rows not already present are added
#   * changed rows: the previous legacy version is archived to legacy._superseded (jsonb), then replaced
#   * new rows are inserted; rows deleted in V2 are REPORTED (legacy._delta_missing), never deleted
# Then a new snapshot row is recorded, 03b-transform.sh runs (idempotent) and 04-reconcile.sh decides pass/fail.
# Without --yes: prints how many rows each table would bring over and exits 2.
set -euo pipefail
# shellcheck source=migration/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SINCE=""; YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="${2:?--since needs a timestamp}"; shift 2 ;;
    --yes) YES=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
need_cmd psql
guard_v2_is_not_new
guard_new_is_new

[[ "$(new_psql -A -t -c "select to_regclass('legacy._snapshot') is not null")" == "t" ]] || die "NEW has no legacy._snapshot — run 03-restore-legacy.sh first"
if [[ -z "$SINCE" ]]; then
  SINCE="$(new_psql -A -t -c "select to_char(max(taken_at) at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from legacy._snapshot")"
fi
[[ -n "$SINCE" ]] || die "no snapshot timestamp found"
NEW_SNAP="$(v2_psql -A -t -c "select to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")"
log "delta window: rows changed in V2 after $SINCE (new snapshot $NEW_SNAP)"

mapfile -t TABLES < <(new_psql -A -t -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                                          where n.nspname = 'legacy' and c.relkind = 'r' and c.relname !~ '^_' order by 1")

cols_of() {  # $1 = psql function, $2 = schema, $3 = table -> comma list of quoted columns in ordinal order
  "$1" -A -t -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns
                  where table_schema = '$2' and table_name = '$3'"
}

if [[ "$YES" == 1 ]]; then
  new_psql -c "create table if not exists legacy._superseded (table_name text not null, legacy_id text, row_data jsonb not null, superseded_at timestamptz not null default now())" \
           -c "create table if not exists legacy._delta_missing (table_name text not null, legacy_id text not null, noticed_at timestamptz not null default now(), primary key (table_name, legacy_id))" \
           -c "create table if not exists legacy._delta_log (table_name text not null, since timestamptz not null, copied int not null, changed int not null, inserted int not null, missing_in_v2 int not null, ran_at timestamptz not null default now())" >/dev/null
fi

TOTAL=0
for T in "${TABLES[@]}"; do
  [[ "$(v2_psql -A -t -c "select to_regclass('public.\"$T\"') is not null")" == "t" ]] || { warn "$T no longer exists in V2 — skipped (legacy copy kept)"; continue; }
  LCOLS="$(cols_of new_psql legacy "$T")"
  VCOLS="$(cols_of v2_psql public "$T")"
  EXTRA="$(comm -13 <(tr ',' '\n' <<<"$LCOLS" | sort) <(tr ',' '\n' <<<"$VCOLS" | sort) | paste -sd, -)"
  [[ -z "$EXTRA" ]] || die "V2 table $T has columns added since the dump ($EXTRA) — take a fresh 01-dump + 03-restore instead of a delta"
  HAS() { tr ',' '\n' <<<"$LCOLS" | grep -qx "$1"; }
  FILTER="true"; MODE="whole table"
  if HAS created_at && HAS updated_at; then FILTER="greatest(created_at, updated_at) > '$SINCE'::timestamptz"; MODE="changed rows"
  elif HAS updated_at; then FILTER="updated_at > '$SINCE'::timestamptz"; MODE="changed rows"
  elif HAS created_at; then FILTER="created_at > '$SINCE'::timestamptz"; MODE="new rows"; fi

  N="$(v2_psql -A -t -c "select count(*) from public.\"$T\" where $FILTER")"
  if [[ "$YES" != 1 ]]; then
    log "   $T: $N rows to copy ($MODE)"; TOTAL=$((TOTAL + N)); continue
  fi

  STG="_delta_$T"
  new_psql -c "set client_min_messages = warning" -c "drop table if exists legacy.\"$STG\"" -c "create table legacy.\"$STG\" (like legacy.\"$T\")" >/dev/null
  v2_psql -c "\\copy (select $LCOLS from public.\"$T\" where $FILTER) to stdout" \
    | new_psql -c "\\copy legacy.\"$STG\" ($LCOLS) from pstdin"

  if HAS id; then
    IDS_FILE="$(mktemp)"
    v2_psql -A -t -c "select id::text from public.\"$T\"" > "$IDS_FILE"
    RESULT="$(new_psql -A -t -F ' ' --single-transaction \
      -c "create temporary table v2_ids (id text primary key) on commit drop" \
      -c "\\copy v2_ids from '$IDS_FILE'" \
      -c "with arch as (
            insert into legacy._superseded(table_name, legacy_id, row_data)
            select '$T', o.id::text, to_jsonb(o) from legacy.\"$T\" o join legacy.\"$STG\" d on d.id = o.id where to_jsonb(o) <> to_jsonb(d)
            returning legacy_id),
          del as (delete from legacy.\"$T\" o using legacy.\"$STG\" d where d.id = o.id and to_jsonb(o) <> to_jsonb(d) returning o.id),
          ins as (insert into legacy.\"$T\" select d.* from legacy.\"$STG\" d
                   where not exists (select 1 from legacy.\"$T\" o where o.id = d.id) or d.id in (select id from del) returning 1),
          miss as (insert into legacy._delta_missing(table_name, legacy_id)
                   select '$T', o.id::text from legacy.\"$T\" o where not exists (select 1 from v2_ids v where v.id = o.id::text)
                   on conflict do nothing returning 1)
          insert into legacy._delta_log(table_name, since, copied, changed, inserted, missing_in_v2)
          select '$T', '$SINCE', (select count(*) from legacy.\"$STG\"), (select count(*) from arch),
                 (select count(*) from ins) - (select count(*) from arch), (select count(*) from miss)
          returning copied, changed, inserted, missing_in_v2" | tail -n 1)"
    rm -f "$IDS_FILE"
  else
    RESULT="$(new_psql -A -t -F ' ' --single-transaction \
      -c "with ins as (insert into legacy.\"$T\" select distinct d.* from legacy.\"$STG\" d
                        where not exists (select 1 from legacy.\"$T\" o where to_jsonb(o) = to_jsonb(d)) returning 1)
          insert into legacy._delta_log(table_name, since, copied, changed, inserted, missing_in_v2)
          select '$T', '$SINCE', (select count(*) from legacy.\"$STG\"), 0, (select count(*) from ins), 0
          returning copied, changed, inserted, missing_in_v2" | tail -n 1)"
  fi
  new_psql -c "drop table legacy.\"$STG\"" >/dev/null
  read -r C CH INS MISS <<<"$RESULT"
  log "   $T ($MODE): copied $C, changed $CH, new $INS, deleted-in-V2 (kept) $MISS"
done

if [[ "$YES" != 1 ]]; then
  log "dry run — $TOTAL rows would be copied. Re-run with --yes."
  exit 2
fi

new_psql -c "insert into legacy._snapshot(kind, taken_at, dump_dir) values ('delta', '$NEW_SNAP', 'delta-$(date -u +%Y%m%dT%H%M%SZ)')" >/dev/null
log "re-running transforms"
"$MIGRATION_DIR/03b-transform.sh"
log "reconciling"
"$MIGRATION_DIR/04-reconcile.sh"
