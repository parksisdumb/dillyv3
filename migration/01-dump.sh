#!/usr/bin/env bash
# 01-dump.sh — point-in-time copy of the Dilly V2 database. READ-ONLY against V2.
#
#   V2_DB_URL=postgresql://postgres:...@db.<v2-ref>.supabase.co:5432/postgres \
#   NEW_DB_URL=postgresql://postgres:...@db.<new-ref>.supabase.co:5432/postgres \
#   migration/01-dump.sh [--skip-auth]
#
# Writes migration/out/<UTC timestamp>/ (override the root with OUT_ROOT=...):
#   snapshot.txt            V2 now() taken BEFORE the dump starts (delta migration uses rows changed after it)
#   v2-schema.sql           schema-only, plain SQL, public schema (human-readable; discovery cross-check)
#   v2-public.dump          pg_dump custom format, public schema, schema + data  (what 03-restore-legacy.sh loads)
#   v2-public-data.dump     pg_dump custom format, public schema, data only      (archive copy)
#   v2-auth.dump            pg_dump custom format, auth schema (users incl. password hashes — keep private)
#   v2-supabase-*.sql       `supabase db dump` copies when the Supabase CLI is installed
#   storage-objects.tsv     list of every storage object (bucket, path, size) — files are NOT in the DB dump
#   STORAGE-NOTE.md         how to download bucket contents
#   row-counts.tsv          table, n_live_tup, exact count(*) before the dump, exact count(*) after the dump
#   MANIFEST.sha256         checksums of every file above
#
# Never writes to V2. Refuses to run if V2_DB_URL looks like the NEW project.
set -euo pipefail
# shellcheck source=migration/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SKIP_AUTH=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-auth) SKIP_AUTH=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

need_cmd psql; need_cmd pg_dump; need_cmd sha256sum
guard_v2_is_not_new

TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_ROOT/$TS"
mkdir -p "$OUT"
chmod 700 "$OUT"
log "writing dump to $OUT"

COUNT_SQL="select c.relname,
       coalesce(s.n_live_tup, 0),
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
 where n.nspname = 'public' and c.relkind in ('r','p')
 order by 1"

log "recording snapshot timestamp (V2 now())"
v2_psql -A -t -c "select to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')" > "$OUT/snapshot.txt"
log "snapshot: $(cat "$OUT/snapshot.txt")"

log "exact row counts (before dump)"
v2_psql -A -t -F $'\t' -c "$COUNT_SQL" > "$OUT/.counts-before.tsv"

log "pg_dump schema-only (public) -> v2-schema.sql"
pg_dump "$V2_DB_URL" --schema-only --schema=public --no-owner --no-privileges -f "$OUT/v2-schema.sql"

log "pg_dump custom format, public schema + data -> v2-public.dump"
pg_dump "$V2_DB_URL" -Fc --schema=public -f "$OUT/v2-public.dump"

log "pg_dump custom format, public data only -> v2-public-data.dump"
pg_dump "$V2_DB_URL" -Fc --data-only --schema=public -f "$OUT/v2-public-data.dump"

if [[ "$SKIP_AUTH" == 1 ]]; then
  warn "--skip-auth: auth schema NOT dumped (reps will need password resets at cutover)"
else
  log "pg_dump custom format, auth schema -> v2-auth.dump (contains password hashes)"
  pg_dump "$V2_DB_URL" -Fc --schema=auth -f "$OUT/v2-auth.dump" \
    || die "auth schema dump failed (use a connection with access to auth.*, or --skip-auth deliberately)"
  chmod 600 "$OUT/v2-auth.dump"
fi

if command -v supabase >/dev/null 2>&1; then
  log "supabase CLI found: supabase db dump (schema) and (data)"
  supabase db dump --db-url "$V2_DB_URL" -f "$OUT/v2-supabase-schema.sql" || warn "supabase db dump (schema) failed — pg_dump copies above are complete"
  supabase db dump --db-url "$V2_DB_URL" --data-only -f "$OUT/v2-supabase-data.sql" || warn "supabase db dump (data) failed — pg_dump copies above are complete"
else
  log "supabase CLI not installed — skipping the optional supabase db dump copy (pg_dump copies are complete)"
fi

log "listing storage objects (files are not in the database dump)"
HAS_STORAGE="$(v2_psql -A -t -c "select to_regclass('storage.objects') is not null")"
if [[ "$HAS_STORAGE" == "t" ]]; then
  v2_psql -c "\\copy (select bucket_id, name, coalesce((metadata->>'size')::bigint, 0) as bytes, created_at from storage.objects order by 1, 2) to '$OUT/storage-objects.tsv' with (format csv, delimiter E'\\t', header true)"
  N_OBJ=$(( $(wc -l < "$OUT/storage-objects.tsv") - 1 ))
else
  printf 'bucket_id\tname\tbytes\tcreated_at\n' > "$OUT/storage-objects.tsv"
  N_OBJ=0
fi
cat > "$OUT/STORAGE-NOTE.md" <<EOF
# Storage buckets (not in the database dump)

$N_OBJ storage objects were listed in storage-objects.tsv at $(cat "$OUT/snapshot.txt").
Download every bucket (Supabase dashboard -> Storage, or \`supabase storage cp -r ss:///<bucket> ./<bucket> --experimental\`)
into this directory under storage/<bucket>/ and keep it with the rest of this dump (local + Google Drive + private bucket).
EOF

log "exact row counts (after dump)"
v2_psql -A -t -F $'\t' -c "$COUNT_SQL" > "$OUT/.counts-after.tsv"
{
  printf 'table\tn_live_tup\tcount_before\tcount_after\n'
  join -t $'\t' -j 1 -o 1.1,1.2,1.3,2.3 \
    <(sort -t $'\t' -k1,1 "$OUT/.counts-before.tsv") <(sort -t $'\t' -k1,1 "$OUT/.counts-after.tsv")
} > "$OUT/row-counts.tsv"
rm -f "$OUT/.counts-before.tsv" "$OUT/.counts-after.tsv"
CHANGED="$(awk -F '\t' 'NR > 1 && $3 != $4 { print $1 }' "$OUT/row-counts.tsv")"
if [[ -n "$CHANGED" ]]; then
  warn "these tables changed while the dump ran (fine — the delta step catches it; re-run at a quiet hour for an exact baseline): $(echo "$CHANGED" | tr '\n' ' ')"
fi

log "writing checksum manifest"
(cd "$OUT" && find . -maxdepth 1 -type f ! -name MANIFEST.sha256 -printf '%f\n' | sort | xargs sha256sum > MANIFEST.sha256)

ln -sfn "$TS" "$OUT_ROOT/latest"
log "done. $(awk 'NR > 1' "$OUT/row-counts.tsv" | wc -l) public tables, $(awk -F '\t' 'NR > 1 { s += $4 } END { print s + 0 }' "$OUT/row-counts.tsv") rows."
log "next: copy $OUT to two more places (Google Drive + private bucket), then run migration/02-discover.sh"
printf '%s\n' "$OUT"
