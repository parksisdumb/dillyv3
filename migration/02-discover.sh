#!/usr/bin/env bash
# 02-discover.sh — describe the Dilly V2 schema (tables, columns, types, enums, checks, FKs, exact row counts,
# enum-like value inventory, and which mapping assumptions hold) into <dump dir>/legacy-schema.md.
#
#   V2_DB_URL=... NEW_DB_URL=... migration/02-discover.sh [--dir migration/out/<ts>]
#       reads the live V2 project (read-only session), schema public. This is what the human runs first.
#   NEW_DB_URL=... migration/02-discover.sh --target new [--dir ...]
#       describes the restored copy in the NEW project's `legacy` schema instead (no V2 access needed).
set -euo pipefail
# shellcheck source=migration/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

TARGET=v2
DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="${2:?--target needs v2|new}"; shift 2 ;;
    --dir) DIR="${2:?--dir needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
need_cmd psql

if [[ -z "$DIR" && ! -e "$OUT_ROOT/latest" ]]; then
  DIR="$OUT_ROOT/$(date -u +%Y%m%dT%H%M%SZ)-discovery"
  mkdir -p "$DIR"
fi
DIR="${DIR:-$(resolve_dump_dir "")}"
mkdir -p "$DIR"
OUT_FILE="$DIR/legacy-schema.md"

case "$TARGET" in
  v2)
    guard_v2_is_not_new
    log "describing V2 schema public -> $OUT_FILE"
    v2_psql -v schema=public -f "$MIGRATION_DIR/discover.sql" > "$OUT_FILE"
    ;;
  new)
    guard_new_is_new
    log "describing NEW schema legacy -> $OUT_FILE"
    new_psql -c "set session characteristics as transaction read only" -v schema=legacy -f "$MIGRATION_DIR/discover.sql" > "$OUT_FILE"
    ;;
  *) die "--target must be v2 or new" ;;
esac

MISSING="$(grep -c '\*\*MISSING\*\*' "$OUT_FILE" || true)"
log "wrote $OUT_FILE ($(wc -l < "$OUT_FILE") lines; $MISSING assumed columns MISSING)"
if [[ "$MISSING" != "0" ]]; then
  warn "edit migration/map/legacy_views.sql so every MISSING column maps to the real V2 column, then re-run"
fi
printf '%s\n' "$OUT_FILE"
