# Dilly V2 → Dilly: FOX Roofing data migration (Supabase SQL editor kit)

Copies FOX Roofing's data from the old **Dilly V2** Supabase project into the new Dilly project. It follows
`09-DATA-MIGRATION-PLAN.md`: **copy, never move**. Everything runs by pasting scripts into the Supabase **SQL Editor**
(no psql or pg_dump, works from Windows).

> **Standing rule: the V2 Supabase project is paused, never deleted, for 12 months after cutover.**
> Nobody deletes it "to clean up". Schema `legacy` in the new project is kept for good. It answers every
> "where did X go" question.

## How it works

```
V2 project (read-only: only SELECTs, through a postgres_fdw server with updatable=false)
   │ 01-connect-v2.sql: one transaction = one consistent snapshot, V2 read once
   ▼
NEW: legacy.<every V2 table> (all 6 orgs, raw, with primary keys)   + migration.snapshot (time, row counts)
   │ 02-preflight.sql: pick the FOX org, value maps, canonical views legacy_v.* (FOX rows only), preflight (RAISES)
   ▼
NEW: public.*  ← 03-transform.sql (one transaction; upsert on (tenant_id, legacy_table, legacy_id); re-runnable)
   │ 04-reconcile.sql: one table, first row = VERDICT (any FAIL blocks cutover)
   ▼
05-drop-fdw.sql removes the V2 connection + password.  Cutover: V2-freeze.sql (in V2) → 06-delta.sql → 02 → 03 → 04
```

| Script | Run in | What it does | Writes to |
|---|---|---|---|
| `sql-editor/01-connect-v2.sql` | NEW | Connects to V2 (you fill in 3 values), copies every V2 table into `legacy`, records snapshot time + row counts. Refuses to run twice once data was transformed. | `legacy`, `migration` |
| `sql-editor/02-preflight.sql` | NEW | Picks the FOX org, (re)builds value maps and views, runs the preflight. Raises with the full list of problems. | `migration`, `legacy_v` only |
| `sql-editor/03-transform.sql` | NEW | All transforms, one transaction, idempotent. Runs the preflight first. Ends with `app.reconcile_tasks`. | `public`, `migration` |
| `sql-editor/04-reconcile.sql` | NEW | PASS/FAIL/WARN/INFO report. Row 1 is the verdict. | nothing (defines `migration.reconcile()`) |
| `sql-editor/05-drop-fdw.sql` | NEW | Drops the foreign server, user mapping (password) and `legacy_fdw`; clears `pg_stat_statements`. | — |
| `sql-editor/06-delta.sql` | NEW | Cutover: re-connects, brings every V2 change since the snapshot into `legacy`, removes the connection again. | `legacy`, `migration` |
| `sql-editor/V2-freeze.sql` | **V2** | Makes V2 read-only for the app (saves the grants first). | V2 grants (+ `dilly_cutover.saved_grant`) |
| `sql-editor/V2-unfreeze.sql` | **V2** | Rollback: restores exactly the saved grants. | V2 grants |
| `discover-sql-editor.sql` | **V2** | Schema discovery (already run: `tests/migration/fixtures/v2-schema-snippet.csv`). | — |

## Runbook (Windows, browser only)

**How to paste a script.** On GitHub open the file (e.g. `migration/sql-editor/02-preflight.sql`) → click
**Copy raw file** (the two-squares icon above the code). In Supabase: left sidebar **SQL Editor** → **+ New query** →
paste with Ctrl+V → **Run** (or Ctrl+Enter). Keep the role selector next to Run on **postgres**. If Supabase asks
"this query has destructive operations", click **Run this query** (the scripts only drop their own bookkeeping
objects). The editor shows the **last result table** of a script; that table is the script's report. If a script
fails, nothing it did is kept (each runs as one transaction) and the red error text says exactly what to fix.

### Step 1: Copy V2 into the new project (10 min)

1. Get the V2 connection values. Supabase dashboard → pick the **V2** project → **Connect** (top bar) →
   **Session pooler** → note **host** (`aws-0-<region>.pooler.supabase.com`), **port** `5432`, **user**
   (`postgres.<v2-project-ref>`). Password = the V2 database password. If nobody has it: V2 project →
   **Project Settings → Database → Reset database password** (the V2 web app signs in with API keys, not this
   password; check no script or outside tool uses it first).
2. Switch to the **NEW** project → **SQL Editor** → **+ New query** → paste `01-connect-v2.sql`.
3. In the `>>> FILL IN` block replace `<V2_POOLER_HOST>`, `<V2_POOLER_USER>`, `<V2_DB_PASSWORD>` (keep the quotes).
   **Type the password only there. Never paste it into a chat.** → **Run**.
4. Check the result: 51 rows (one per V2 table), `v2_rows` = `copied_rows` on every row.
5. Delete the password from the editor tab (and don't save the snippet), then run **`05-drop-fdw.sql`**:
   result says `PASS: no V2 server or credentials stored`.

### Step 2: Preflight (2 min)

Run **`02-preflight.sql`**. Expected: a table starting with `preflight | PASS`, the FOX org, and the counts that
will load (accounts, contacts, properties, opportunities, touches, follow-ups).

If it errors:
- **"N V2 orgs match …fox…"**: the message lists every V2 org with its id. Put FOX's id in the line
  `('fox_org_id_override', null, …)` at the top of the script (`null` → `'<the id>'`) and run again.
- **"migration preflight failed … unmapped … value …"**: each line names the value, the V2 column and how many rows
  use it. Send Claude the error text (it holds no secrets). Claude adds the rows to the value maps in
  `02-preflight.sql`; you re-paste it and run again. Nothing has been written to the app.

### Step 3: Transform (1 min)

Run **`03-transform.sql`**. Result: rows per entity (accounts, contacts, properties, ownership rows, opportunities,
touches, follow-ups, follow-ups still open, people signed in / invited, rows flagged). Running it again changes
nothing (it is idempotent).

### Step 4: Reconcile (1 min) — blocks cutover on any FAIL

Run **`04-reconcile.sql`**. **Row 1 = VERDICT.** `PASS` = OK to cut over; `FAIL` = do not, the FAIL rows say what
differs. Keep a copy: **Export → Download CSV** above the results.

Checks: tables classified; the raw copy intact; **no other V2 org migrated**; per entity counts, every legacy id
present, no extras; users; property-contact links; each building's current manager/owner; opportunity value total
and per stage; touches per rep per ISO week; contacts and properties per account; notes length (no truncation);
touch fields (channel/outcome/direction/time/rep); task created/due dates; 10 timestamps side by side in UTC and
Central; account type / onboarding / preference distributions; no open follow-up with a later touch; migration
created no tasks or points; V2 points kept for comparison; people not signed in (WARN); flags and duplicate
suggestions (INFO).

### Step 5: People

Reps who have not signed in to Dilly get an invite and keep all their history (user columns stay empty, the V2
person is kept in `migration.unmapped_actor`). After they sign in: run **`02` → `03` → `04`** again. Their touches,
follow-ups and assignments are attributed to them; `unmapped_actors` goes to PASS. No points are awarded for history.
V2 password hashes are not copied: reps sign in with a magic link or reset their password.

### Step 6: Human spot-check

Each rep opens five of their accounts in Dilly: contacts, timeline and open follow-ups must match V2. Tyler signs off
on the pipeline ($ total = `opportunity_value_total`). Review:
`select * from migration.flagged_row order by flag;` and `select * from migration.duplicate_suggestion;`.

### Step 7: Cutover (Friday 17:00 freeze → Monday 06:00 switch)

1. **V2 project** → SQL Editor → run **`V2-freeze.sql`**. Result: `tables_still_writable_by_reps = 0`. Reps can still
   read V2. (It also stops V2's own Gmail sync and agents from writing; set `freeze_service_role := false` to keep them.)
2. **NEW project** → run **`06-delta.sql`** with the same 3 values as step 1. Result: per table `changed`, `new_rows`,
   `gone_from_v2_kept`. It removes the V2 connection itself at the end.
3. Run **`02` → `03` → `04`**. Row 1 must be `PASS`.
4. Switch reps to Dilly.

Rollback: V2 project → **`V2-unfreeze.sql`** (restores exactly the saved grants).

Delta details: changed V2 rows are archived to `legacy._superseded` before being replaced; rows deleted in V2 are
listed in `legacy._delta_missing` and **never removed** (they stay migrated); new V2 columns are added to the legacy
table. If `touch_fields_match` FAILs, a rep edited a touch in V2 after the first load: the Dilly ledger is append-only,
so void and re-log that touch in Dilly.

### Step 8: After cutover

- Reset the V2 database password (Project Settings → Database). Any copy of it is then useless.
- Weeks 0–2: V2 stays read-only and reachable. Fix any discrepancy from `legacy.*`.
- Day 90: pause the V2 project (never delete it). Month 12: decide on deletion, in writing.

## What maps where

| V2 (real schema) | Dilly | Notes |
|---|---|---|
| `orgs` (6) | tenant `fox` | Only the org whose name contains "fox" (or the override). Other orgs stay in `legacy` only; reconcile checks none leaked. |
| `org_users` (+ `memberships`/`roles`, `profiles.full_name`) | `migration.user_map` → `membership` if the email already signed in to Dilly, else `invite` | Matched by email, case-insensitive. Role: rep/manager/admin (V2 CHECK). Users without email are kept and reported. |
| `accounts` | `account` | `account_type` mapped; `onboarding_status` (V2 CHECK keys) set on insert; `status` → `account_preference`; owner = first `account_assignments` row, else the rep with most `property_assignments` on its buildings, else the creating rep. V2 has **no P1–P4 column**: `icp_tier` stays at Dilly's default and the ICP score is recomputed. |
| `account_assignments` (2nd+) | `account_assignment` (support) | |
| `contacts` | `contact` (+ `contact_employment` via Dilly's trigger, source `dillyv2`) | first/last kept; when both empty `full_name` is split at the last space (V2 name kept if different). `decision_role` → `persona_role`. |
| `properties` | `property` | `address_line1, address_line2` joined; `building_type` → `asset_class`; `roof_type` → `roof_system`; `sq_footage` → `roof_area_sf` (V2 value also kept); `roof_age_years` → `roof_install_year`. `account_id` is **not** written directly (next row). |
| `property_accounts` + `properties.primary_account_id` | `property_party` rows, source `dillyv2` | `owner` → owner, `property_manager` → manager; ended/inactive links become history rows (`ended_on`); the property's primary account becomes the manager (owner if a manager is already set). Dilly's trigger then sets `property.account_id` (manager, else owner). gc/consultant/vendor/other links → `migration.legacy_value`. A building whose management was changed **in Dilly** is owned by Dilly: re-runs and the delta leave it alone. |
| `property_contacts` (PK property+contact+role) | `property_contact` (one row per property+contact, roles joined) | inactive links are flagged, not linked. |
| `property_assignments` | `property_pursuit` (active) | once per V2 row; ending it in Dilly is respected. |
| `opportunities` (+ `scope_types`, `opportunity_stages`, `lost_reason_types`, `opportunity_assignments`) | `opportunity` | stage = status `won`/`lost` if set, else the stage lookup; value = final, else bid, else estimated; lost reason = reason name + notes; owner = primary assignment. All three values, V2 stage, created_reason kept in `legacy_value`. |
| `touchpoints` (+ `touchpoint_types`, `touchpoint_outcomes`) | `touch` (source `dillyv2`) | `happened_at` → `occurred_at`; rep, direction, notes, property, opportunity kept; engagement phase in `legacy_value`. Inserted in time order. Triggers only stamp freshness and close tasks: no new tasks, no points. |
| `synced_emails` | see decision below | |
| `next_actions` | `task` (kind `follow_up`) | `due_at` → due date in Central time; status open/done/dropped; completed/created-from touchpoints linked; notes → reason. `app.reconcile_tasks` then closes every one that already has a later touch. |
| `score_events` | not migrated as points | per-person V2 total kept as `legacy_points`. |
| everything else (`touchpoint_revisions`, `streaks`, `score_rules`, `territories*`, `prospects`, `import_batches`, `suggested_outreach`, `icp_*`, `intel_*`, `agent_*`, `benchmark_snapshots`, `kpi_*`, `milestone*`, `merge_events`, `email_connections`, `org_invites`, `demo_requests`) | legacy only | listed with a reason in `migration.table_disposition`. |

## Decisions

- **Synced emails.** V2 links a synced Gmail message to the touchpoint it created (`synced_emails.touchpoint_id`).
  Linked messages add **no** touch: their Gmail id goes on that touch as `external_id = 'gmail:<id>'`, which is also
  what Dilly's own Gmail sync checks, so it never logs them again. Messages matched to a contact but never logged
  (`touchpoint_id` null) become touches (email, `sent` outbound / `replied` inbound, `legacy_table = 'synced_emails'`),
  unless an email touchpoint on the same contact within 10 minutes already represents them. Messages with no matched
  contact stay in legacy. One Gmail message on two V2 touches: the first keeps the id, the second is flagged.
- **Touchpoint revisions** stay in legacy only. The touchpoint row already holds the edited (current) values; the
  revision history is there for "who changed what".
- **Soft-deleted V2 rows** (`deleted_at` set) are not shown in Dilly; they stay in legacy and are flagged
  `soft_deleted_in_v2`. Rows pointing at them migrate with that link empty (flagged `orphan`).
- **Follow-up created by a touch.** V2 writes the follow-up in the same transaction as its touch, so both carry the
  same timestamp. The task is stamped 1 ms after its own touch so that touch does not also close it
  (original kept as `legacy_value v2_created_at`; reconcile checks the rule).
- **Lookup values** (types, outcomes, stages, scope types) map by the lookup row's **name**, then its **key**;
  matching ignores case, spaces, underscores, dashes, slashes and curly apostrophes. Unknown values never become
  null: the preflight stops and lists them.
- **Nothing is dropped or merged:** test rows → `is_test` + `migration.flagged_row`; duplicates →
  `migration.duplicate_suggestion`; values with no Dilly column → `migration.legacy_value`.

## Values the preflight will confirm on the real data

The CSV gives V2's columns and CHECK constraints but not the lookup **rows**. Confirmed by CHECK constraints:
onboarding status keys, org roles, touch/email direction, property relationship types. Mapped from the V2 UI labels
plus likely keys, **to be confirmed by the first preflight run**: touchpoint type names (9 rows), outcome names
(19 rows), stage names (13 rows: 8 seen in the UI, 5 unknown, maybe other orgs'), scope type names (9 rows),
`accounts.account_type` and `accounts.status` free-text values, `contacts.decision_role`, `opportunities.status`,
`next_actions.status`. Anything unexpected stops the preflight with its name, key and row count.

## Tests

`tests/migration/migration.test.ts` builds a V2 database with exactly the real schema (from
`tests/migration/fixtures/v2-schema-snippet.csv`: 51 tables, every column, type, default, PK/FK/UNIQUE/CHECK), fills
it with FOX plus two other orgs (`fixtures/v2-data.sql`), and runs every script the way the SQL editor does (whole file,
one query) through a real postgres_fdw connection: 01 → 02 → 03 twice (identical fingerprint) → 04 PASS, other orgs
absent, follow-up closing, Gmail handling, ownership history, people, flags, unmapped value raising, org ambiguity,
05, re-attribution, 06 delta with a Dilly-side transfer, and V2 freeze/unfreeze.
