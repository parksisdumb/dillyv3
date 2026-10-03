#!/usr/bin/env bash
# 03b-transform.sh — legacy.* -> public.* inside the NEW database, in ONE transaction (all or nothing). Re-runnable.
#
#   NEW_DB_URL=... [TENANT_SLUG=fox] [LEGACY_ORG_ID=<V2 FOX organization id>] migration/03b-transform.sh [--reattribute]
#
# Order: value_maps.sql -> legacy_views.sql -> 05_preflight.sql (raises on any unmapped value; nothing written)
#        -> 00_tenant_and_users -> 10_accounts -> 20_contacts -> 30_properties -> 35_property_contacts
#        -> 40_opportunities -> 50_touches -> 60_tasks -> 70_preferences_and_onboarding -> 90_post
#        [-> 95_reattribute with --reattribute: fill touch.user_id for reps who have signed in since]
# LEGACY_ORG_ID empty = every row in the dump belongs to FOX (single-org V2). Set it if V2 holds other orgs.
set -euo pipefail
# shellcheck source=migration/lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

REATTRIBUTE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --reattribute) REATTRIBUTE=1; shift ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
need_cmd psql
guard_new_is_new

TENANT_SLUG="${TENANT_SLUG:-fox}"
LEGACY_ORG_ID="${LEGACY_ORG_ID:-}"
M="$MIGRATION_DIR/map"
FILES=(
  "$M/value_maps.sql" "$M/legacy_views.sql" "$M/05_preflight.sql"
  "$M/00_tenant_and_users.sql" "$M/10_accounts.sql" "$M/20_contacts.sql" "$M/30_properties.sql"
  "$M/35_property_contacts.sql" "$M/40_opportunities.sql" "$M/50_touches.sql" "$M/60_tasks.sql"
  "$M/70_preferences_and_onboarding.sql" "$M/90_post.sql"
)
[[ "$REATTRIBUTE" == 1 ]] && FILES+=("$M/95_reattribute.sql")

ARGS=()
for f in "${FILES[@]}"; do
  [[ -f "$f" ]] || die "missing $f"
  ARGS+=(-f "$f")
done

log "transforming legacy -> public for tenant '$TENANT_SLUG' (legacy org: ${LEGACY_ORG_ID:-all rows}) in one transaction"
for f in "${FILES[@]}"; do log "   $(basename "$f")"; done
new_psql --single-transaction -v tenant_slug="$TENANT_SLUG" -v legacy_org_id="$LEGACY_ORG_ID" \
  -c "set client_min_messages = warning" "${ARGS[@]}" -o /dev/null \
  || die "transform failed and was rolled back — nothing in public changed (see the message above)"

new_psql -A -t -c "select detail from migration.run_log where step = 'transform' order by id desc limit 1" | sed 's/^/[migration] result: /' >&2
log "preflight passed; transform committed. next: migration/04-reconcile.sh"
