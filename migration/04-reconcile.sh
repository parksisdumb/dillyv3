#!/usr/bin/env bash
# 04-reconcile.sh — pass/fail report comparing legacy.* (the raw V2 copy) with what landed in public.*.
#
#   NEW_DB_URL=... [TENANT_SLUG=fox] migration/04-reconcile.sh [--dir migration/out/<ts>]
#
# Writes reconcile-<UTC>.md and .tsv next to the dump (or to OUT_ROOT) and prints the summary.
# Exit 0 = no FAIL rows (WARN/INFO allowed). Exit 1 = at least one FAIL: cutover is blocked.
set -euo pipefail
# shellcheck source=migration/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
need_cmd psql
guard_new_is_new
if [[ -z "$DIR" ]]; then
  if [[ -e "$OUT_ROOT/latest" ]]; then DIR="$(resolve_dump_dir "")"; else DIR="$OUT_ROOT"; fi
fi
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TSV="$DIR/reconcile-$STAMP.tsv"
MD="$DIR/reconcile-$STAMP.md"

log "reconciling legacy vs public (tenant ${TENANT_SLUG:-fox})"
new_psql -c "insert into migration.config(key, value) values ('tenant_slug', '${TENANT_SLUG:-fox}') on conflict (key) do update set value = excluded.value" >/dev/null
new_psql -A -F $'\t' -P footer=off -f "$MIGRATION_DIR/reconcile.sql" > "$TSV"

N_FAIL="$(awk -F '\t' 'NR > 1 && $6 == "FAIL"' "$TSV" | wc -l)"
N_WARN="$(awk -F '\t' 'NR > 1 && $6 == "WARN"' "$TSV" | wc -l)"
N_PASS="$(awk -F '\t' 'NR > 1 && $6 == "PASS"' "$TSV" | wc -l)"
VERDICT=$([[ "$N_FAIL" == 0 ]] && echo PASS || echo FAIL)
{
  echo "# Dilly V2 -> Dilly reconcile report — $VERDICT"
  echo
  echo "- Run: $STAMP (UTC), tenant ${TENANT_SLUG:-fox}, database $(db_identity "$NEW_DB_URL")"
  echo "- $N_PASS PASS · $N_FAIL FAIL · $N_WARN WARN. Any FAIL blocks cutover."
  echo
  echo "| # | check | entity | expected | actual | status | detail |"
  echo "|---:|---|---|---|---|---|---|"
  awk -F '\t' 'NR > 1 { for (i = 1; i <= NF; i++) gsub(/\|/, "/", $i); printf "| %s | %s | %s | %s | %s | %s | %s |\n", $1, $2, $3, $4, $5, ($6 == "FAIL" ? "**FAIL**" : $6), $7 }' "$TSV"
} > "$MD"

awk -F '\t' 'NR > 1 && ($6 == "FAIL" || $6 == "WARN") { printf "  %-5s %-32s %-30s expected %s, got %s %s\n", $6, $2, $3, $4, $5, $7 }' "$TSV" >&2
log "report: $MD"
log "verdict: $VERDICT ($N_PASS pass, $N_FAIL fail, $N_WARN warn)"
[[ "$N_FAIL" == 0 ]] || exit 1
