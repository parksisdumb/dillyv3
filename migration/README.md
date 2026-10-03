# Dilly V2 → Dilly: FOX Roofing data migration runbook

This kit copies FOX Roofing's data from the old **Dilly V2** Supabase project into the new Dilly database.
It follows `09-DATA-MIGRATION-PLAN.md`: **copy, never move**.

> **Standing rule: the V2 Supabase project is paused, never deleted, for 12 months after cutover.**
> Nobody deletes it "to clean up". The `legacy` schema in the new project is kept for good. It answers every "where did X go" question.

## How it works

```
V2 (read-only) ──01-dump──▶ migration/out/<ts>/  (dumps + checksums + snapshot time + exact counts)
                               │
                 03-restore-legacy (scratch Postgres in between; atomic swap)
                               ▼
NEW: legacy.*  (exact raw copy) ──legacy_views.sql──▶ legacy_v.* (canonical names)
                               │  value_maps.sql + 05_preflight.sql (unmapped value ⇒ stop, nothing written)
                               ▼
NEW: public.* (00 → 90 transforms, one transaction, upsert on (tenant_id, legacy_table, legacy_id))
                               │
                     04-reconcile ⇒ PASS / FAIL report (any FAIL blocks cutover)
```

| File | What it does | Writes to |
|---|---|---|
| `01-dump.sh` | pg_dump of V2: schema-only SQL, custom-format public (schema+data and data-only), auth schema, storage listing, exact row counts before and after, `snapshot.txt`, `MANIFEST.sha256` | local `migration/out/<ts>/` only |
| `02-discover.sh` + `discover.sql` | `legacy-schema.md`: tables, exact counts, columns and types, enums, checks, FKs, triggers and policies, the **value inventory** of every enum-like column, and an **assumption check** of every column the mapping expects | local file only |
| `03-restore-legacy.sh` | Restores the dump into schema `legacy` in NEW (needs `--yes`) | scratch DB (created and dropped), NEW `legacy` |
| `03b-transform.sh` | Runs `map/*.sql` in one transaction. Re-runnable. | NEW `migration`, `legacy_v`, `public` |
| `map/legacy_views.sql` | **The only file that knows real V2 table and column names.** Edit it when discovery disagrees. | |
| `map/value_maps.sql` | `migration` schema, config, and every V2 value → new code (touch types, outcomes, stages, P1–P4, onboarding, account types, roles, statuses) | |
| `map/05_preflight.sql` | Raises with the full list of unmapped values, invalid targets, duplicate ids, and unclassified tables | |
| `map/00…90_*.sql` | Transforms in dependency order: users → accounts → contacts → properties → property contacts → opportunities → touches → tasks → preferences and onboarding → post (`app.reconcile_tasks`, duplicate suggestions) | |
| `map/95_reattribute.sql` | Optional (`--reattribute`). Fills `touch.user_id` for reps who signed in after the load. | |
| `reconcile.sql` + `04-reconcile.sh` | Pass/fail report (`reconcile-<ts>.md`). Exits 1 on any FAIL. | report file |
| `05-freeze-v2.sql` / `05-unfreeze-v2.sql` | Cutover: revokes and restores app-role writes on V2. Saves the exact grants first. | V2 grants only |
| `06-delta.sh` | Copies V2 rows changed after the last snapshot, then re-runs transform and reconcile (needs `--yes`) | NEW `legacy`, `public` |
| `scratch-stubs.sql`, `scratch-normalize.sql` | Used by step 03 inside the scratch database only | scratch |

### Guarantees

- **V2 is never written** except by the deliberate freeze at cutover. Every psql session to V2 runs `set session characteristics as transaction read only`. pg_dump is read-only.
- Scripts refuse to run if `V2_DB_URL` points at the NEW database. They check the URL, the server/database identity, and whether `app.reconcile_tasks` exists.
- Every migrated row has `source='dillyv2'`, `legacy_table`, and `legacy_id`. Reconcile checks that no `dillyv2` row is missing a `legacy_id`.
- **Nothing is dropped or merged:**
  - test rows → `is_test=true` plus `migration.flagged_row`
  - duplicates → `migration.duplicate_suggestion`; `duplicate_of` is left untouched
  - orphans (broken V2 FKs) → migrated unlinked and flagged
  - unknown reps → `migration.unmapped_actor`
  - fields with no new column (opportunity notes, legacy priority/score/points, Gmail thread ids, provenance) → `migration.legacy_value`
- **Enums never become null.** A value with no row in `value_maps.sql` stops the run before anything is written.
- **Migrated touches** (`source='dillyv2'`) only stamp freshness and close tasks. They create no new tasks and award no points. Points and ICP score are recomputed by the app. Legacy totals and P1–P4 are kept for comparison.
- **Follow-ups** keep their original `created_at` and due date. `app.reconcile_tasks(fox)` then closes every one that already has a later touch on the same contact or account.

## Prerequisites

- `psql`, `pg_dump`, `pg_restore` version 15 or newer (at least the V2 server's major version), plus `sha256sum`.
- A **scratch Postgres** you can throw away, e.g. `docker run -d -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16`. It must not be the V2 server.
- **Direct** connection strings, not the transaction pooler: `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres`.

```bash
export V2_DB_URL='postgresql://postgres:***@db.<v2-ref>.supabase.co:5432/postgres'
export NEW_DB_URL='postgresql://postgres:***@db.<new-ref>.supabase.co:5432/postgres'
export SCRATCH_DB_URL='postgresql://postgres@localhost:5433/postgres'
export TENANT_SLUG=fox                 # new tenant (seeded by supabase/migrations/*_initial_tenants.sql)
export LEGACY_ORG_ID=                  # V2 FOX organization id if V2 holds other orgs; empty = all rows
```

`migration/out/` holds customer data and password hashes. It is git-ignored. Never commit it.

## Runbook

### Step 1: Dump V2 (now, then weekly until cutover)

```bash
migration/01-dump.sh
```

Check:
- The last line prints the dump directory.
- `row-counts.tsv` totals look right. The Sep 13 baseline was 116 accounts, 510 contacts, 472 properties, 18 opportunities and 6 users.
- No "changed while the dump ran" warning. If there is one, re-run at a quiet hour.

Then:
- Download the storage buckets listed in `storage-objects.tsv` (see `STORAGE-NOTE.md`).
- Copy the whole directory to Google Drive and a private bucket. One copy is zero copies.
- Turn on PITR in the V2 dashboard.

### Step 2: Discovery (do this first)

```bash
migration/02-discover.sh          # -> migration/out/<ts>/legacy-schema.md
```

Check:
- **Section 7** must show no `**MISSING**` columns. For each one that does, edit `map/legacy_views.sql`. Change only the right-hand expressions; keep the canonical aliases. Tables V2 has that the mapping does not know go into `migration.table_disposition` (bottom of `legacy_views.sql`) as `migrated` or `legacy_only`.
- **Section 5** lists every enum-like value. Each must have a row in `map/value_maps.sql`. Spelling, dashes and apostrophes must match; case and spacing do not matter.
- **Section 2** flags `timestamp` columns with **NO TZ**. Wrap those in `legacy_views.sql` as `(col at time zone 'UTC')`.

### Step 3: Load the raw copy into NEW

```bash
migration/03-restore-legacy.sh           # dry run: prints the plan, exits 2
migration/03-restore-legacy.sh --yes     # replaces schema legacy in NEW (atomic swap)
migration/02-discover.sh --target new    # optional: describe what landed
```

Check: "6/6 done" with the same row total as `row-counts.tsv`. If a table fails to create in scratch, add the missing Supabase stub to `scratch-stubs.sql` and re-run. Details are in `restore-*/restore-scratch.log`.

### Step 4: Transform

```bash
migration/03b-transform.sh
```

Check:
- If preflight fails, nothing was written. Fix `value_maps.sql` or `legacy_views.sql` and re-run.
- The result line lists counts per entity.
- Running it again must change nothing (it is idempotent).

### Step 5: Reconcile (blocks cutover on any FAIL)

```bash
migration/04-reconcile.sh                # exit 0 = PASS, 1 = FAIL; report in reconcile-<ts>.md
```

The report covers:
- per-entity counts, and that every legacy id is present
- opportunity value total and per-stage totals
- touches per rep per ISO week
- contacts and properties per account
- notes length, so truncation shows up
- touch field fidelity
- 10 touches with timestamps side by side, in UTC and tenant time
- P1–P4, onboarding and preference distributions
- open tasks that already have a later touch (must be 0)
- unmapped actors (WARN)
- flags and duplicate suggestions (INFO)

### Step 6: People

Reps who have not signed in get a `public.invite` and keep their history: user columns stay null and the actor is kept in `migration.unmapped_actor`. After they sign in:

```bash
migration/03b-transform.sh --reattribute && migration/04-reconcile.sh
```

`unmapped_actors` should go to 0. Password hashes are in `v2-auth.dump` if the team decides to import them. The fallback is a password-reset link at cutover.

### Step 7: Human spot-check

Each rep opens five of their own accounts in the new app: contacts, timeline and open follow-ups must match V2. Tyler signs off on the pipeline list ($ total = reconcile `opportunity_value_total`). Also review:
- `migration.flagged_row`: test rows, orphans, duplicate Gmail ids
- `migration.duplicate_suggestion`

### Step 8: Rehearsal

Run steps 1 → 5 end to end against a fresh clone of the new project and time it.

### Step 9: Cutover (Friday 17:00 freeze → Monday 06:00 switch)

```bash
psql "$V2_DB_URL" -v ON_ERROR_STOP=1 -v grants_file=migration/out/v2-grants-before-freeze.sql \
     -v freeze_service_role=1 -f migration/05-freeze-v2.sql      # V2 read-only (reads still work)
migration/06-delta.sh                                            # dry run: rows changed since snapshot
migration/06-delta.sh --yes                                      # copy, transform, reconcile; exit 0 required
```

Rollback, if needed: `psql "$V2_DB_URL" -v grants_file=migration/out/v2-grants-before-freeze.sql -f migration/05-unfreeze-v2.sql`.

Delta details:
- Rows V2 changed are archived in `legacy._superseded` before being replaced.
- Rows deleted in V2 are listed in `legacy._delta_missing` and never removed.
- If reconcile reports `touch_fields_match` FAIL, a rep edited a touch in V2 after the load. The ledger is append-only: void and re-log that touch in the new app.

### Step 10: After cutover

- Weeks 0–2: V2 stays read-only and reachable. Fix any discrepancy from `legacy.*`.
- Day 90: pause the V2 project (never delete it). Archive a final `01-dump.sh` alongside the others.
- Month 12: decide on deletion, in writing.

## Assumptions to confirm (V2 repo or discovery output)

The V2 schema was not available when this kit was written. Everything below is a best guess from the Sep 13, 2026 app review, and lives in `map/legacy_views.sql` (names) or `map/value_maps.sql` (values). Section 7 of `legacy-schema.md` checks the column names automatically.

| Area | Assumed |
|---|---|
| Table names | `profiles` (could be `users`), `follow_ups` (could be `tasks`), `property_contacts` join table (could be `contacts.property_id`), `organizations`; every business table has `org_id` |
| accounts | `type`, `address`, `priority` as `P1`–`P4`, `score`, `onboarding_status` (ladder labels), `status` codes `active` / `do_not_pursue` / `existing_client` / `competitor` / `deprioritized`, `assigned_to` (owner), `created_by`, `notes` |
| contacts | `account_id`, `first_name`, `last_name`, `title`, `email`, `phone`, `mobile`, `notes` |
| properties | direct `account_id`, `property_type`, `roof_type`, `sqft`, `buildings` |
| opportunities | `contact_id`, `type` (service type: Repair / Re-Roof / Maintenance / Inspection / Coating), `stage`, `value`, `assigned_to`, `stage_updated_at`, `notes` |
| touchpoints | `user_id` (rep), `type`, `outcome`, `direction`, `source` (`manual` / `gmail`), `gmail_message_id`, `gmail_thread_id`, `points`, `opportunity_id`; **`created_at` is the touch time** (no separate occurred_at) |
| follow_ups | `assigned_to`, `due_date`, `status` (`pending` / `completed` / `dismissed`), `title`, `notes`, `snooze_count`, `touchpoint_id`, `completed_at` |
| profiles | `email`, `full_name`, `role` (rep / manager / admin), `points` = leaderboard total |
| Outcome labels marked ASSUMED | "No Answer — no voicemail", "Not Interested", "Call Back Later", "Bid Requested", "Auto-Reply" / "Auto Reply" (Gmail out-of-office capture) |
| Timestamps | `timestamptz` (stored UTC) |
