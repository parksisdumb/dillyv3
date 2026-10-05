-- value_maps.sql — the `migration` schema: run configuration, bookkeeping tables, helper functions,
-- and EVERY legacy value -> new code mapping. Idempotent; re-run freely (03b-transform.sh runs it first).
--
-- Rules
--   * Enums map by explicit lookup row, never by fuzzy string match. Keys are compared case-insensitively with
--     whitespace collapsed (migration.vkey); dashes, apostrophes and wording must match exactly.
--   * A NULL legacy value is the key '<null>' and must be mapped explicitly too.
--   * A legacy value with no row here stops the migration in 05_preflight.sql with the full list of unmapped values.
--   * new_value NULL means "explicitly nothing" and is allowed only where migration.value_domain.allow_null is true.
-- psql variables (set by 03b-transform.sh): :tenant_slug (default fox), :legacy_org_id ('' = every row in the dump).

create schema if not exists migration;
comment on schema migration is 'Dilly V2 -> Dilly migration bookkeeping (maps, user map, flags, reconcile). Keep with legacy.';

-- ---------------------------------------------------------------------------------------------- config
create table if not exists migration.config (key text primary key, value text);
insert into migration.config(key, value) values
  ('tenant_slug', nullif(:'tenant_slug', '')),
  ('legacy_org_id', nullif(:'legacy_org_id', ''))
on conflict (key) do update set value = excluded.value;

create or replace function migration.cfg(k text) returns text language sql stable as
  $$ select value from migration.config where key = k $$;

create or replace function migration.tenant_id() returns uuid language sql stable as
  $$ select id from public.tenant where slug = coalesce(migration.cfg('tenant_slug'), 'fox') $$;

-- Rows of other V2 organizations (if V2 is multi-org) are out of scope when legacy_org_id is set.
create or replace function migration.in_scope(org text) returns boolean language sql stable as
  $$ select migration.cfg('legacy_org_id') is null or org = migration.cfg('legacy_org_id') $$;

-- ---------------------------------------------------------------------------------------------- entities
-- canonical name (what the transforms say) -> real V2 table name (what legacy_table stores) -> target table.
-- Filled by legacy_views.sql, the only file that knows real V2 names.
create table if not exists migration.entity (
  canonical    text primary key,
  legacy_table text not null,
  target_table text not null
);
create or replace function migration.lt(canonical_name text) returns text language sql stable as
  $$ select legacy_table from migration.entity where canonical = canonical_name $$;

-- Every table in the restored `legacy` schema must be classified, or reconcile FAILs (nothing is silently ignored).
create table if not exists migration.table_disposition (
  legacy_table text primary key,
  disposition  text not null check (disposition in ('migrated', 'legacy_only')),
  note         text not null
);

-- ---------------------------------------------------------------------------------------------- value maps
create or replace function migration.vkey(v text) returns text language sql immutable as
  $$ select coalesce(nullif(lower(regexp_replace(btrim(v), '\s+', ' ', 'g')), ''), '<null>') $$;

create table if not exists migration.value_domain (
  domain      text primary key,
  target_type text not null,          -- a type name to cast into, or 'one_of:a,b,c' / 'int:1-4'
  allow_null  boolean not null default false,
  legacy_from text not null           -- documentation: which legacy column feeds it
);
create table if not exists migration.value_map (
  domain       text not null references migration.value_domain(domain),
  legacy_value text not null,
  legacy_key   text generated always as (migration.vkey(legacy_value)) stored,
  new_value    text,
  note         text,
  primary key (domain, legacy_key)
);

insert into migration.value_domain(domain, target_type, allow_null, legacy_from) values
  ('account_type',      'app.account_type',        false, 'accounts.type'),
  ('account_status',    'app.preference',          true,  'accounts.status (NULL = no account_preference row)'),
  ('icp_priority',      'int:1-4',                 false, 'accounts.priority (P1..P4)'),
  ('onboarding_status', 'app.onboarding_status',   false, 'accounts.onboarding_status'),
  ('user_role',         'one_of:owner,admin,manager,rep,estimator,pm,reviewer', false, 'profiles.role'),
  ('touch_type',        'app.channel',             false, 'touchpoints.type'),
  ('touch_outcome',     'app.outcome',             false, 'touchpoints.outcome'),
  ('touch_direction',   'one_of:outbound,inbound', false, 'touchpoints.direction'),
  ('touch_source',      'one_of:rep,gmail,outlook,import,agent', false, 'touchpoints.source (kept as provenance; touch.source is always dillyv2)'),
  ('opp_stage',         'app.stage',               false, 'opportunities.stage'),
  ('opp_type',          'app.service_line',        false, 'opportunities.type'),
  ('task_status',       'one_of:open,done,dropped', false, 'follow_ups.status')
on conflict (domain) do update set target_type = excluded.target_type, allow_null = excluded.allow_null, legacy_from = excluded.legacy_from;

insert into migration.value_map(domain, legacy_value, new_value, note) values
  -- account types (exist in V2 but barely used; FOX book is PMC-heavy)
  ('account_type', 'Owner', 'owner', null),
  ('account_type', 'Property Mgmt', 'property_mgmt', null),
  ('account_type', 'Property Management', 'property_mgmt', null),
  ('account_type', 'Facilities', 'facilities', null),
  ('account_type', 'Asset Mgmt', 'asset_mgmt', null),
  ('account_type', 'Asset Management', 'asset_mgmt', null),
  ('account_type', 'GC', 'gc', null),
  ('account_type', 'General Contractor', 'gc', null),
  ('account_type', 'Developer', 'developer', null),
  ('account_type', 'Broker', 'broker', null),
  ('account_type', 'Consultant', 'consultant', null),
  ('account_type', 'Vendor', 'vendor', null),
  ('account_type', 'Other', 'other', null),
  ('account_type', 'HOA', 'condo_hoa_mgmt', null),
  ('account_type', 'Condo/HOA', 'condo_hoa_mgmt', null),
  ('account_type', 'HOA Management', 'condo_hoa_mgmt', null),
  ('account_type', 'Community Association', 'condo_hoa_mgmt', null),
  ('account_type', '<null>', 'other', 'type never set in V2'),
  -- account status -> account_preference (NULL = no preference row)
  ('account_status', 'active', null, null),
  ('account_status', '<null>', null, null),
  ('account_status', 'do_not_pursue', 'do_not_pursue', 'ASSUMED V2 code'),
  ('account_status', 'Do Not Pursue', 'do_not_pursue', null),
  ('account_status', 'existing_client', 'existing_client', 'ASSUMED V2 code'),
  ('account_status', 'Existing Client', 'existing_client', null),
  ('account_status', 'competitor', 'competitor', 'ASSUMED V2 code'),
  ('account_status', 'deprioritized', 'deprioritize', 'ASSUMED V2 code'),
  -- ICP priority P1..P4 (kept as icp_tier; legacy text also kept in migration.legacy_value)
  ('icp_priority', 'P1', '1', null), ('icp_priority', 'P2', '2', null),
  ('icp_priority', 'P3', '3', null), ('icp_priority', 'P4', '4', null),
  ('icp_priority', '1', '1', null), ('icp_priority', '2', '2', null), ('icp_priority', '3', '3', null), ('icp_priority', '4', '4', null),
  ('icp_priority', '<null>', '3', 'no priority in V2 -> default P3 (new schema default)'),
  -- vendor onboarding ladder
  ('onboarding_status', 'Initial Touch', 'initial_touch', null),
  ('onboarding_status', 'Onboarding Paperwork Started', 'paperwork_started', null),
  ('onboarding_status', 'Onboarding Paperwork Received', 'paperwork_received', null),
  ('onboarding_status', 'Onboarding Paperwork Finished', 'paperwork_finished', null),
  ('onboarding_status', 'Compliant / Active Vendor', 'compliant', null),
  ('onboarding_status', '<null>', 'none', null),
  ('onboarding_status', 'None', 'none', null),
  -- roles
  ('user_role', 'rep', 'rep', null), ('user_role', 'manager', 'manager', null), ('user_role', 'admin', 'admin', null),
  -- touch types -> channel
  ('touch_type', 'Call', 'call', null),
  ('touch_type', 'Email', 'email', null),
  ('touch_type', 'Text', 'text', null),
  ('touch_type', 'Door Knock', 'door_knock', null),
  ('touch_type', 'Site Visit', 'site_visit', null),
  ('touch_type', 'Inspection', 'inspection', null),
  ('touch_type', 'Meeting', 'meeting', 'ASSUMED'),
  ('touch_type', 'LinkedIn', 'linkedin', 'ASSUMED'),
  -- outcomes (V2 has 15; labels from the Sep 13 review — confirm exact spelling against discovery section 5)
  ('touch_outcome', 'Connected — had a conversation', 'connected', null),
  ('touch_outcome', 'Connected', 'connected', null),
  ('touch_outcome', 'No Answer — left voicemail', 'voicemail', null),
  ('touch_outcome', 'No Answer — no voicemail', 'no_answer', 'ASSUMED label'),
  ('touch_outcome', 'No Answer', 'no_answer', null),
  ('touch_outcome', 'Gatekeeper — couldn''t get through', 'gatekeeper', null),
  ('touch_outcome', 'Gatekeeper — couldn’t get through', 'gatekeeper', 'typographic apostrophe variant'),
  ('touch_outcome', 'Scheduled — booked inspection', 'scheduled_inspection', null),
  ('touch_outcome', 'Not Interested', 'not_interested', 'ASSUMED label'),
  ('touch_outcome', 'Call Back Later', 'call_back_later', 'ASSUMED label'),
  ('touch_outcome', 'Bid Requested', 'bid_requested', 'ASSUMED label'),
  ('touch_outcome', 'Bid Submitted', 'bid_submitted', null),
  ('touch_outcome', 'Met in Person', 'met_in_person', null),
  ('touch_outcome', 'Not There', 'not_there', null),
  ('touch_outcome', 'Got a Reply', 'replied', null),
  ('touch_outcome', 'Bounced', 'bounced', null),
  ('touch_outcome', 'Sent', 'sent', null),
  ('touch_outcome', 'Auto-Reply', 'auto_reply', 'ASSUMED label for Gmail out-of-office captures'),
  ('touch_outcome', 'Auto Reply', 'auto_reply', 'ASSUMED label'),
  -- direction
  ('touch_direction', 'outbound', 'outbound', null), ('touch_direction', 'inbound', 'inbound', null),
  ('touch_direction', '<null>', 'outbound', 'V2 default'),
  -- provenance of the V2 touch (Gmail flag)
  ('touch_source', 'manual', 'rep', null), ('touch_source', '<null>', 'rep', null),
  ('touch_source', 'gmail', 'gmail', null), ('touch_source', 'outlook', 'outlook', null),
  ('touch_source', 'import', 'import', 'ASSUMED'), ('touch_source', 'csv', 'import', 'ASSUMED'),
  -- opportunity stages
  ('opp_stage', 'Lead', 'lead', null),
  ('opp_stage', 'Contacted', 'contacted', null),
  ('opp_stage', 'Inspection Scheduled', 'inspection_scheduled', null),
  ('opp_stage', 'Inspection Complete', 'inspection_complete', null),
  ('opp_stage', 'Proposal Sent', 'proposal_sent', null),
  ('opp_stage', 'Negotiation', 'negotiation', null),
  ('opp_stage', 'Won', 'won', null), ('opp_stage', 'Closed Won', 'won', null),
  ('opp_stage', 'Lost', 'lost', null), ('opp_stage', 'Closed Lost', 'lost', null),
  -- opportunity type -> service line
  ('opp_type', 'Repair', 'repair', null),
  ('opp_type', 'Re-Roof', 're_roof', null), ('opp_type', 'Reroof', 're_roof', null), ('opp_type', 'Replacement', 're_roof', null),
  ('opp_type', 'Re-Cover', 're_cover', null),
  ('opp_type', 'Maintenance', 'maintenance', null),
  ('opp_type', 'Inspection', 'inspection', null),
  ('opp_type', 'Coating', 'coating', null),
  ('opp_type', 'Emergency', 'emergency', null),
  ('opp_type', 'New Construction', 'new_construction', null),
  ('opp_type', '<null>', 'repair', 'new schema default'),
  -- follow-up status -> task status
  ('task_status', 'pending', 'open', null), ('task_status', 'open', 'open', null), ('task_status', 'snoozed', 'open', null),
  ('task_status', 'overdue', 'open', null), ('task_status', '<null>', 'open', null),
  ('task_status', 'completed', 'done', null), ('task_status', 'done', 'done', null),
  ('task_status', 'dismissed', 'dropped', null), ('task_status', 'cancelled', 'dropped', null), ('task_status', 'skipped', 'dropped', null)
on conflict (domain, legacy_key) do update set new_value = excluded.new_value, note = excluded.note, legacy_value = excluded.legacy_value;

-- Strict lookup used by every transform: raises on an unmapped value (preflight reports them all first).
create or replace function migration.map(d text, v text) returns text language plpgsql stable as $$
declare r text;
begin
  select new_value into r from migration.value_map where domain = d and legacy_key = migration.vkey(v);
  if not found then
    raise exception 'unmapped % value: %', d, coalesce(v, '<null>') using hint = 'add a row to migration/map/value_maps.sql';
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------------------------- people
create table if not exists migration.user_map (
  tenant_id        uuid not null,
  legacy_table     text not null,
  legacy_user_id   text not null,
  email            text,
  full_name        text,
  legacy_role      text,
  new_role         text,
  profile_id       uuid,          -- set when a NEW profile with the same email exists
  invite_id        uuid,          -- set when the person has not signed in yet
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, legacy_user_id)
);
create or replace function migration.uid(legacy_user text) returns uuid language sql stable as
  $$ select profile_id from migration.user_map where tenant_id = migration.tenant_id() and legacy_user_id = legacy_user $$;

-- A legacy row whose actor has no NEW profile yet. Never dropped: user columns stay null and the actor is kept here.
create table if not exists migration.unmapped_actor (
  tenant_id       uuid not null,
  legacy_table    text not null,
  legacy_id       text not null,
  role_column     text not null,           -- owner | created_by | actor | assignee
  legacy_user_id  text not null,
  legacy_email    text,
  first_seen_at   timestamptz not null default now(),
  resolved_profile_id uuid,                -- filled once that person signs in (re-run 00 + 95_reattribute)
  primary key (tenant_id, legacy_table, legacy_id, role_column)
);

-- ---------------------------------------------------------------------------------------------- flags & carry-over
-- Values that have no column in the new schema (legacy priority/score/points, opportunity notes, Gmail thread ids...).
create table if not exists migration.legacy_value (
  tenant_id    uuid not null,
  target_table text not null,
  target_id    uuid,
  legacy_table text not null,
  legacy_id    text not null,
  field        text not null,
  value        text,
  primary key (tenant_id, legacy_table, legacy_id, field)
);
-- Rows flagged for human review: test data, orphans (broken V2 FKs), placeholder names, dropped Gmail ids...
create table if not exists migration.flagged_row (
  tenant_id    uuid not null,
  legacy_table text not null,
  legacy_id    text not null,
  flag         text not null,
  detail       text,
  primary key (tenant_id, legacy_table, legacy_id, flag)
);
-- Duplicate suggestions. Nothing is merged during migration; merges happen in the app with an audit trail.
create table if not exists migration.duplicate_suggestion (
  tenant_id     uuid not null,
  entity        text not null,
  record_id     uuid not null,
  duplicate_of  uuid not null,
  reason        text not null,
  primary key (tenant_id, entity, record_id, duplicate_of)
);
create table if not exists migration.run_log (
  id         bigserial primary key,
  step       text not null,
  detail     jsonb not null default '{}'::jsonb,
  ran_at     timestamptz not null default now()
);

-- Test-data patterns from the V2 audit ("test 3 test 3", "123 Test 2", "address TBD").
create or replace function migration.looks_test(variadic vals text[]) returns boolean language sql immutable as $$
  select coalesce(bool_or(v ~* '(\mtest\M|\mTBD\M|^\s*123 test)'), false) from unnest(vals) v
$$;

-- Record every legacy row whose actor (owner / creator / rep / assignee) has no NEW profile yet.
create or replace function migration.note_actors(view_name text, user_col text, role_col text) returns int
language plpgsql as $$
declare n int;
begin
  execute format($q$
    insert into migration.unmapped_actor as a (tenant_id, legacy_table, legacy_id, role_column, legacy_user_id, legacy_email)
    select migration.tenant_id(), v.legacy_table, v.legacy_id, %L, v.%I, m.email
      from legacy_v.%I v
      left join migration.user_map m on m.tenant_id = migration.tenant_id() and m.legacy_user_id = v.%I
     where migration.in_scope(v.org_id) and v.%I is not null and m.profile_id is null
    on conflict (tenant_id, legacy_table, legacy_id, role_column) do update
       set legacy_user_id = excluded.legacy_user_id, legacy_email = excluded.legacy_email$q$,
    role_col, user_col, view_name, user_col, user_col);
  get diagnostics n = row_count;
  return n;
end $$;

-- Never expose migration bookkeeping through the API roles.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema migration from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema migration from authenticated'; end if;
end $$;
