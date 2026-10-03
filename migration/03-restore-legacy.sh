#!/usr/bin/env bash
# 03-restore-legacy.sh — load the raw V2 copy into schema `legacy` inside the NEW project.
#
#   NEW_DB_URL=... SCRATCH_DB_URL=postgresql://postgres@localhost:5432/postgres \
#   migration/03-restore-legacy.sh [--dir migration/out/<ts>] [--keep-scratch] --yes
#
# Approach (no sed on dump files, no schema-rename tricks inside the NEW project):
#   1. Create a throwaway database on the SCRATCH server (any plain Postgres >= the V2 major version, e.g.
#      `docker run -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`). Apply scratch-stubs.sql there.
#   2. pg_restore v2-public.dump into scratch `public`: pre-data and post-data are tolerant (V2 policies, triggers,
#      FKs to auth.users, views are skipped via a filtered TOC); the DATA section runs with --exit-on-error in one
#      transaction, so every row either lands or the script stops.
#   3. Verify exact row counts in scratch == row-counts.tsv from the dump.
#   4. In scratch: rename schema public -> legacy, normalize (scratch-normalize.sql: enums/domains -> text,
#      no defaults/functions/policies), rename to legacy_incoming, add _snapshot and _row_counts.
#   5. pg_dump that one schema and pg_restore it into NEW as `legacy_incoming`; then in ONE transaction
#      drop the old `legacy` (+ dependent legacy_v views) and rename legacy_incoming -> legacy. Counts verified again.
#   6. Drop the scratch database (unless --keep-scratch).
# Without --yes nothing is changed: the script prints the plan and exits 2.
set -euo pipefail
# shellcheck source=migration/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DIR=""; YES=0; KEEP_SCRATCH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    --yes) YES=1; shift ;;
    --keep-scratch) KEEP_SCRATCH=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
need_cmd psql; need_cmd pg_restore; need_cmd pg_dump; need_cmd sha256sum
need_env SCRATCH_DB_URL
guard_new_is_new
DIR="$(resolve_dump_dir "$DIR")"
verify_manifest "$DIR"
[[ -f "$DIR/v2-public.dump" ]] || die "missing $DIR/v2-public.dump"

SCRATCH_ID="$(db_identity "$SCRATCH_DB_URL")" || die "cannot connect to SCRATCH_DB_URL"
if [[ -n "${V2_DB_URL:-}" ]]; then
  [[ "${SCRATCH_ID%/*}" != "$(db_identity "$V2_DB_URL" | sed 's#/.*##')" ]] || die "SCRATCH_DB_URL is on the V2 server — use a separate Postgres"
fi
[[ "${SCRATCH_ID%/*}" != "$(db_identity "$NEW_DB_URL" | sed 's#/.*##')" ]] || warn "scratch database will be created on the same server as NEW (fine locally; on Supabase prefer a local Postgres)"

CURRENT="$(new_psql -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'legacy' and c.relkind = 'r'")"
log "plan: restore $DIR/v2-public.dump into NEW schema legacy (currently $CURRENT tables; it will be replaced)"
if [[ "$YES" != 1 ]]; then
  log "dry run — nothing changed. Re-run with --yes to drop and recreate schema legacy in NEW."
  exit 2
fi

SCRATCH_DB="dilly_legacy_scratch_$(date -u +%Y%m%d%H%M%S)_$$"
SCRATCH_URL="$(url_with_db "$SCRATCH_DB_URL" "$SCRATCH_DB")"
WORK="$DIR/restore-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$WORK"
LOGF="$WORK/restore-scratch.log"

cleanup() {
  if [[ "$KEEP_SCRATCH" == 1 ]]; then
    log "kept scratch database $SCRATCH_DB"
  else
    psql "$SCRATCH_DB_URL" -X -q -c "drop database if exists \"$SCRATCH_DB\"" >/dev/null 2>&1 || warn "could not drop scratch database $SCRATCH_DB"
  fi
}
trap cleanup EXIT

log "1/6 creating scratch database $SCRATCH_DB on $SCRATCH_ID"
psql "$SCRATCH_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "create database \"$SCRATCH_DB\""
psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIGRATION_DIR/scratch-stubs.sql" >>"$LOGF" 2>&1

log "2/6 restoring V2 public schema into scratch (filtered TOC; data section is all-or-nothing)"
pg_restore -l "$DIR/v2-public.dump" > "$WORK/toc.all"
grep -v -E '^[0-9]+; [0-9]+ [0-9]+ (POLICY|TRIGGER|EVENT TRIGGER|FK CONSTRAINT|ROW SECURITY|PUBLICATION|PUBLICATION TABLE|RULE|VIEW|MATERIALIZED VIEW|MATERIALIZED VIEW DATA|ACL|DEFAULT ACL|COMMENT|EXTENSION|SCHEMA) ' \
  "$WORK/toc.all" > "$WORK/toc.filtered" || true
log "   skipped TOC entries: $(( $(grep -c -E '^[0-9]+;' "$WORK/toc.all") - $(grep -c -E '^[0-9]+;' "$WORK/toc.filtered" || true) )) (policies, triggers, FKs, views, ACLs — see $WORK/toc.all)"
pg_restore --section=pre-data -L "$WORK/toc.filtered" --no-owner --no-privileges -d "$SCRATCH_URL" "$DIR/v2-public.dump" >>"$LOGF" 2>&1 \
  || warn "pre-data restore reported errors (tolerated; tables are verified next) — see $LOGF"

MISSING_TABLES=""
while read -r tbl; do
  [[ -z "$tbl" ]] && continue
  ok="$(psql "$SCRATCH_URL" -X -A -t -q -c "select to_regclass('public.\"$tbl\"') is not null")"
  [[ "$ok" == "t" ]] || MISSING_TABLES="$MISSING_TABLES $tbl"
done < <(awk '$4 == "TABLE" && $5 == "public" { print $6 }' "$WORK/toc.filtered")
[[ -z "$MISSING_TABLES" ]] || die "tables failed to create in scratch:$MISSING_TABLES — add stubs to migration/scratch-stubs.sql (details: $LOGF)"

pg_restore --section=data -L "$WORK/toc.filtered" --no-owner --no-privileges --exit-on-error --single-transaction \
  -d "$SCRATCH_URL" "$DIR/v2-public.dump" >>"$LOGF" 2>&1 || die "data restore into scratch failed — see $LOGF"
pg_restore --section=post-data -L "$WORK/toc.filtered" --no-owner --no-privileges -d "$SCRATCH_URL" "$DIR/v2-public.dump" >>"$LOGF" 2>&1 \
  || warn "post-data restore reported errors (indexes/keys only; tolerated) — see $LOGF"

log "3/6 verifying exact row counts in scratch against row-counts.tsv"
psql "$SCRATCH_URL" -X -A -t -q -F $'\t' -c "$(exact_counts_sql public)" > "$WORK/scratch-counts.tsv"
BAD=0
while IFS=$'\t' read -r tbl _live before after; do
  [[ "$tbl" == "table" ]] && continue
  got="$(awk -F '\t' -v t="$tbl" '$1 == t { print $2 }' "$WORK/scratch-counts.tsv")"
  if [[ "$before" == "$after" && "$got" != "$after" ]]; then
    warn "row count mismatch for $tbl: dump-time $after, restored ${got:-missing}"; BAD=1
  elif [[ "$before" != "$after" ]]; then
    log "   $tbl changed during the dump ($before -> $after rows); restored $got (between the two is expected)"
  fi
done < "$DIR/row-counts.tsv"
[[ "$BAD" == 0 ]] || die "restored row counts do not match the dump — stopping"

log "4/6 renaming scratch public -> legacy, normalizing types, then -> legacy_incoming"
psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 -c "alter schema public rename to legacy" -c "create schema public" >>"$LOGF" 2>&1
psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 -f "$MIGRATION_DIR/scratch-normalize.sql" >>"$LOGF" 2>&1 || die "normalize failed — see $LOGF"
psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 -c "alter schema legacy rename to legacy_incoming" >>"$LOGF" 2>&1
SNAP="$(cat "$DIR/snapshot.txt")"
psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 \
  -c "create table legacy_incoming._snapshot (kind text not null, taken_at timestamptz not null, dump_dir text not null, loaded_at timestamptz not null default now())" \
  -c "insert into legacy_incoming._snapshot(kind, taken_at, dump_dir) values ('initial', '$SNAP', '$(basename "$DIR")')" \
  -c "create table legacy_incoming._row_counts (table_name text primary key, restored_count bigint not null)" >>"$LOGF" 2>&1
psql "$SCRATCH_URL" -X -q -v ON_ERROR_STOP=1 -c "\\copy legacy_incoming._row_counts from '$WORK/scratch-counts.tsv'" >>"$LOGF" 2>&1

log "5/6 copying schema legacy into NEW (atomic swap)"
pg_dump "$SCRATCH_URL" -Fc --schema=legacy_incoming --no-owner --no-privileges -f "$WORK/legacy.dump"
new_psql -c "set client_min_messages = warning" -c "drop schema if exists legacy_incoming cascade" >/dev/null
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction -d "$NEW_DB_URL" "$WORK/legacy.dump" \
  || die "restore into NEW failed (NEW legacy schema untouched)"
new_psql -1 -c "set client_min_messages = warning" \
  -c "drop schema if exists legacy_v cascade" \
  -c "drop schema if exists legacy cascade" \
  -c "alter schema legacy_incoming rename to legacy" \
  -c "do \$\$ begin
        if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema legacy from anon'; end if;
        if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema legacy from authenticated'; end if;
        execute 'comment on schema legacy is ''Raw Dilly V2 copy (FOX Roofing). Never edit; keep forever.''';
      end \$\$"

new_psql -A -t -F $'\t' -c "$(exact_counts_sql legacy)" > "$WORK/new-legacy-counts.tsv"
diff -u "$WORK/scratch-counts.tsv" "$WORK/new-legacy-counts.tsv" || die "row counts in NEW legacy differ from scratch"
log "6/6 done: $(wc -l < "$WORK/new-legacy-counts.tsv") tables, $(awk -F '\t' '{ s += $2 } END { print s + 0 }' "$WORK/new-legacy-counts.tsv") rows in NEW schema legacy"
log "next: migration/03b-transform.sh"
