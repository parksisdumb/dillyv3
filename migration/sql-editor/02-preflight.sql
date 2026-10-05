-- =====================================================================================================================
-- 02-preflight.sql — run in the NEW Dilly project (Supabase → SQL Editor → paste → Run). Safe to re-run.
--
-- Writes ONLY to the bookkeeping schemas `migration` and `legacy_v` (never to public.*):
--   1. picks the FOX Roofing org in the V2 copy (name ilike '%fox%'; exactly one match, or the override below)
--   2. (re)creates every value map (V2 value → Dilly code). This file is the source of truth for the maps.
--   3. (re)creates the canonical views legacy_v.* over the raw V2 copy in schema `legacy` (real V2 column names)
--   4. runs migration.preflight(): RAISES with the full list of problems — unmapped values (with row counts),
--      invalid map targets, unclassified tables — before anything is written. 03-transform.sql runs it again.
-- Result: one table "check / value". If it errors, read the message: it lists exactly what to fix.
-- =====================================================================================================================

-- >>> EDIT ONLY IF THE ORG SEARCH FAILS: the V2 org id of FOX Roofing (copy it from the error message), e.g.
-- >>>   ('fox_org_id_override', '0f0f0000-0000-4000-8000-000000000001')
-- >>> Leave null to pick the one org whose name contains "fox".
create schema if not exists migration;
create table if not exists migration.settings (key text primary key, value text, note text);
insert into migration.settings(key, value, note) values
  ('fox_org_id_override', null, 'set in 02-preflight.sql when the name search is ambiguous'),
  ('tenant_slug', 'fox', 'NEW tenant that receives the FOX data')
on conflict (key) do update set value = excluded.value;

set statement_timeout = 0;

-- ------------------------------------------------------------------------------------------------- settings & scope
create or replace function migration.setting(k text) returns text language sql stable as
  $$ select value from migration.settings where key = k $$;
create or replace function migration.tenant_id() returns uuid language sql stable as
  $$ select id from public.tenant where slug = coalesce(migration.setting('tenant_slug'), 'fox') $$;
create or replace function migration.fox_org() returns uuid language sql stable as
  $$ select nullif(migration.setting('fox_org_id'), '')::uuid $$;
-- Only rows of the FOX org are migrated. Rows of every other V2 org stay in `legacy` and are never read.
create or replace function migration.in_scope(org uuid) returns boolean language sql stable as
  $$ select coalesce(org = migration.fox_org(), false) $$;

do $pick$
declare
  v_override text := migration.setting('fox_org_id_override');
  v_list text;
  v_n int;
  v_id uuid;
begin
  if to_regclass('legacy.orgs') is null then
    raise exception 'legacy.orgs is missing: run 01-connect-v2.sql first (it copies Dilly V2 into schema legacy)';
  end if;
  select string_agg(format('%s  %s  (%s accounts, %s touchpoints)', o.id, o.name,
           (select count(*) from legacy.accounts a where a.org_id = o.id),
           (select count(*) from legacy.touchpoints t where t.org_id = o.id)), E'\n' order by o.name)
    into v_list from legacy.orgs o;
  if v_override is not null then
    select id into v_id from legacy.orgs where id::text = btrim(v_override);
    if v_id is null then
      raise exception E'fox_org_id_override % is not a V2 org. V2 orgs:\n%', v_override, v_list;
    end if;
  else
    select count(*), min(id::text)::uuid into v_n, v_id from legacy.orgs where name ilike '%fox%';
    if v_n <> 1 then
      raise exception E'% V2 orgs match name ilike ''%%fox%%''. Put the FOX org id in fox_org_id_override at the top of 02-preflight.sql and run again. V2 orgs:\n%',
        v_n, v_list;
    end if;
  end if;
  insert into migration.settings(key, value, note)
  values ('fox_org_id', v_id::text, (select 'V2 org: ' || name from legacy.orgs where id = v_id))
  on conflict (key) do update set value = excluded.value, note = excluded.note;
  raise notice 'FOX org in V2: % (%)', v_id, (select name from legacy.orgs where id = v_id);
end $pick$;

-- ------------------------------------------------------------------------------------------------- bookkeeping tables
create table if not exists migration.user_map (
  tenant_id        uuid not null,
  legacy_table     text not null,
  legacy_user_id   text not null,
  email            text,
  full_name        text,
  legacy_role      text,
  new_role         text,
  profile_id       uuid,          -- set when a NEW profile with the same email exists (the person signed in)
  invite_id        uuid,          -- set while the person has not signed in yet
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, legacy_user_id)
);
-- A legacy row whose actor has no NEW profile yet. Never dropped: user columns stay null and the actor is kept here.
create table if not exists migration.unmapped_actor (
  tenant_id       uuid not null,
  legacy_table    text not null,
  legacy_id       text not null,
  role_column     text not null,           -- owner | created_by | actor | assignee
  legacy_user_id  text not null,
  legacy_email    text,
  first_seen_at   timestamptz not null default now(),
  resolved_profile_id uuid,
  primary key (tenant_id, legacy_table, legacy_id, role_column)
);
-- V2 values with no column in Dilly (legacy scores, engagement phase, Gmail subject, stage at loss, ...).
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
-- Rows for human review: test data, orphans, soft-deleted V2 rows, inactive links, duplicate Gmail ids, ...
create table if not exists migration.flagged_row (
  tenant_id    uuid not null,
  legacy_table text not null,
  legacy_id    text not null,
  flag         text not null,
  detail       text,
  primary key (tenant_id, legacy_table, legacy_id, flag)
);
create table if not exists migration.duplicate_suggestion (
  tenant_id     uuid not null,
  entity        text not null,
  record_id     uuid not null,
  duplicate_of  uuid not null,
  reason        text not null,
  primary key (tenant_id, entity, record_id, duplicate_of)
);
-- Rows created from a V2 row that have no legacy columns of their own (property_party, property_pursuit, ...).
create table if not exists migration.link (
  tenant_id    uuid not null,
  legacy_key   text not null,          -- e.g. property_accounts:<id>, properties.primary_account_id:<property id>
  target_table text not null,
  target_id    uuid not null,
  created_at   timestamptz not null default now(),
  primary key (tenant_id, legacy_key, target_table)
);
create table if not exists migration.run_log (
  id     bigserial primary key,
  step   text not null,
  detail jsonb not null default '{}'::jsonb,
  ran_at timestamptz not null default now()
);
-- Every table copied into `legacy` must be classified, or preflight/reconcile FAIL (nothing silently ignored).
drop table if exists migration.table_disposition;
create table migration.table_disposition (
  legacy_table text primary key,
  disposition  text not null check (disposition in ('migrated', 'legacy_only')),
  note         text not null
);

-- ------------------------------------------------------------------------------------------------- value maps
-- Keys compare case-, whitespace-, underscore-, dash- and slash-insensitively, and typographic apostrophes equal
-- straight ones: 'No Answer — left voicemail' = 'no_answer_left_voicemail' = 'NO ANSWER - LEFT VOICEMAIL'.
-- A NULL / empty V2 value is the key '<null>' and must be mapped explicitly too.
create or replace function migration.vkey(v text) returns text language sql immutable as $$
  select coalesce(nullif(btrim(regexp_replace(translate(lower(v), '‘’`´', ''''''''''), '[\s_/‐‑‒–—―-]+', ' ', 'g')), ''), '<null>')
$$;

drop table if exists migration.value_map;
drop table if exists migration.value_domain;
create table migration.value_domain (
  domain      text primary key,
  target_type text not null,          -- a type to cast into, or 'one_of:a,b,c'
  allow_null  boolean not null default false,
  legacy_from text not null
);
create table migration.value_map (
  domain       text not null references migration.value_domain(domain),
  legacy_value text not null,
  legacy_key   text generated always as (migration.vkey(legacy_value)) stored,
  new_value    text,
  note         text,
  primary key (domain, legacy_key)
);

insert into migration.value_domain(domain, target_type, allow_null, legacy_from) values
  ('account_type',      'app.account_type',      false, 'accounts.account_type (free text)'),
  ('account_status',    'app.preference',        true,  'accounts.status (NULL = no account_preference row)'),
  ('onboarding_status', 'app.onboarding_status', false, 'accounts.onboarding_status (V2 CHECK: initial_touch..compliant)'),
  ('user_role',         'one_of:owner,admin,manager,rep,estimator,pm,reviewer', false, 'org_users.role (V2 CHECK: rep/manager/admin), roles.key'),
  ('decision_role',     'app.persona_role',      false, 'contacts.decision_role (free text)'),
  ('touch_type',        'app.channel',           false, 'touchpoint_types.name, else .key'),
  ('touch_outcome',     'app.outcome',           false, 'touchpoint_outcomes.name, else .key (NULL outcome_id = <null>)'),
  ('touch_direction',   'one_of:outbound,inbound', false, 'touchpoints.direction / synced_emails.direction (V2 CHECK)'),
  ('opp_stage',         'app.stage',             false, 'opportunity_stages.name, else .key'),
  ('opp_status',        'app.stage',             true,  'opportunities.status (won/lost override the stage; NULL = keep stage)'),
  ('scope_type',        'app.service_line',      false, 'scope_types.name, else .key'),
  ('task_status',       'one_of:open,done,dropped', false, 'next_actions.status'),
  ('party_role',        'app.party_role',        true,  'property_accounts.relationship_type (V2 CHECK; NULL = not an owner/manager party)');

insert into migration.value_map(domain, legacy_value, new_value, note) values
  -- account types: UI labels + likely stored keys
  ('account_type', 'Owner', 'owner', null),
  ('account_type', 'Property Owner', 'owner', null),
  ('account_type', 'Property Mgmt', 'property_mgmt', null),
  ('account_type', 'Property Management', 'property_mgmt', null),
  ('account_type', 'Property Manager', 'property_mgmt', null),
  ('account_type', 'PMC', 'property_mgmt', null),
  ('account_type', 'Facilities', 'facilities', null),
  ('account_type', 'Facility', 'facilities', null),
  ('account_type', 'Facilities Management', 'facilities', null),
  ('account_type', 'Asset Mgmt', 'asset_mgmt', null),
  ('account_type', 'Asset Management', 'asset_mgmt', null),
  ('account_type', 'Asset Manager', 'asset_mgmt', null),
  ('account_type', 'GC', 'gc', null),
  ('account_type', 'General Contractor', 'gc', null),
  ('account_type', 'Developer', 'developer', null),
  ('account_type', 'Broker', 'broker', null),
  ('account_type', 'Consultant', 'consultant', null),
  ('account_type', 'Vendor', 'vendor', null),
  ('account_type', 'Architect', 'architect', null),
  ('account_type', 'REIT', 'reit', null),
  ('account_type', 'Institutional', 'institutional', null),
  ('account_type', 'Government', 'government', null),
  ('account_type', 'Education', 'education', null),
  ('account_type', 'Healthcare', 'healthcare', null),
  ('account_type', 'HOA', 'condo_hoa_mgmt', null),
  ('account_type', 'Condo/HOA', 'condo_hoa_mgmt', null),
  ('account_type', 'Condo HOA Mgmt', 'condo_hoa_mgmt', null),
  ('account_type', 'HOA Management', 'condo_hoa_mgmt', null),
  ('account_type', 'Community Association', 'condo_hoa_mgmt', null),
  ('account_type', 'Condo Association', 'condo_hoa_mgmt', null),
  ('account_type', 'Other', 'other', null),
  ('account_type', '<null>', 'other', 'type never set in V2'),
  -- account status -> account_preference (NULL = no preference row). V2 has no CHECK on status: ASSUMED values.
  ('account_status', 'active', null, 'V2 default'),
  ('account_status', '<null>', null, null),
  ('account_status', 'prospect', null, 'ASSUMED'),
  ('account_status', 'lead', null, 'ASSUMED'),
  ('account_status', 'inactive', 'deprioritize', 'ASSUMED'),
  ('account_status', 'archived', 'deprioritize', 'ASSUMED'),
  ('account_status', 'Do Not Pursue', 'do_not_pursue', 'ASSUMED'),
  ('account_status', 'DNP', 'do_not_pursue', 'ASSUMED'),
  ('account_status', 'Existing Client', 'existing_client', 'ASSUMED'),
  ('account_status', 'Customer', 'existing_client', 'ASSUMED'),
  ('account_status', 'Client', 'existing_client', 'ASSUMED'),
  ('account_status', 'Competitor', 'competitor', 'ASSUMED'),
  ('account_status', 'Deprioritized', 'deprioritize', 'ASSUMED'),
  ('account_status', 'Deprioritize', 'deprioritize', 'ASSUMED'),
  ('account_status', 'Partner', 'partner', 'ASSUMED'),
  -- vendor onboarding ladder: V2 CHECK keys (confirmed) + UI labels
  ('onboarding_status', 'initial_touch', 'initial_touch', 'V2 CHECK'),
  ('onboarding_status', 'paperwork_started', 'paperwork_started', 'V2 CHECK'),
  ('onboarding_status', 'paperwork_received', 'paperwork_received', 'V2 CHECK'),
  ('onboarding_status', 'paperwork_finished', 'paperwork_finished', 'V2 CHECK'),
  ('onboarding_status', 'compliant', 'compliant', 'V2 CHECK'),
  ('onboarding_status', 'Onboarding Paperwork Started', 'paperwork_started', 'UI label'),
  ('onboarding_status', 'Onboarding Paperwork Received', 'paperwork_received', 'UI label'),
  ('onboarding_status', 'Onboarding Paperwork Finished', 'paperwork_finished', 'UI label'),
  ('onboarding_status', 'Compliant / Active Vendor', 'compliant', 'UI label'),
  -- roles
  ('user_role', 'rep', 'rep', 'V2 CHECK'), ('user_role', 'manager', 'manager', 'V2 CHECK'), ('user_role', 'admin', 'admin', 'V2 CHECK'),
  ('user_role', 'owner', 'admin', 'ASSUMED roles.key; never grants Dilly tenant ownership'),
  ('user_role', 'member', 'rep', 'ASSUMED roles.key'),
  -- contact decision role (free text in V2): ASSUMED values
  ('decision_role', '<null>', 'unknown', null),
  ('decision_role', 'unknown', 'unknown', null),
  ('decision_role', 'other', 'unknown', 'ASSUMED'),
  ('decision_role', 'Decision Maker', 'economic_buyer', 'ASSUMED'),
  ('decision_role', 'Economic Buyer', 'economic_buyer', 'ASSUMED'),
  ('decision_role', 'Influencer', 'influencer', 'ASSUMED'),
  ('decision_role', 'Champion', 'influencer', 'ASSUMED'),
  ('decision_role', 'Evaluator', 'evaluator', 'ASSUMED'),
  ('decision_role', 'Technical', 'evaluator', 'ASSUMED'),
  ('decision_role', 'Gatekeeper', 'gatekeeper', 'ASSUMED'),
  ('decision_role', 'Initiator', 'initiator', 'ASSUMED'),
  ('decision_role', 'User', 'user', 'ASSUMED'),
  ('decision_role', 'End User', 'user', 'ASSUMED'),
  -- touchpoint types -> channel (UI labels seen in V2; the rest ASSUMED)
  ('touch_type', 'Call', 'call', 'UI label'),
  ('touch_type', 'Phone Call', 'call', 'ASSUMED'),
  ('touch_type', 'Email', 'email', 'UI label'),
  ('touch_type', 'Text', 'text', 'UI label'),
  ('touch_type', 'SMS', 'text', 'ASSUMED'),
  ('touch_type', 'Door Knock', 'door_knock', 'UI label'),
  ('touch_type', 'Site Visit', 'site_visit', 'UI label'),
  ('touch_type', 'Inspection', 'inspection', 'UI label'),
  ('touch_type', 'Meeting', 'meeting', 'ASSUMED'),
  ('touch_type', 'LinkedIn', 'linkedin', 'ASSUMED'),
  ('touch_type', 'Mail', 'mail', 'ASSUMED'),
  ('touch_type', 'Direct Mail', 'mail', 'ASSUMED'),
  ('touch_type', 'Event', 'event', 'ASSUMED'),
  ('touch_type', 'Lunch & Learn', 'lunch_and_learn', 'ASSUMED'),
  ('touch_type', 'Lunch and Learn', 'lunch_and_learn', 'ASSUMED'),
  ('touch_type', 'Roof Walk', 'roof_walk', 'ASSUMED'),
  ('touch_type', 'Other', 'other', 'ASSUMED'),
  -- outcomes (UI labels seen in V2; the rest ASSUMED). The V2 outcome name is also kept in migration.legacy_value.
  ('touch_outcome', 'Connected — had a conversation', 'connected', 'UI label'),
  ('touch_outcome', 'Connected', 'connected', 'ASSUMED key'),
  ('touch_outcome', 'No Answer — left voicemail', 'voicemail', 'UI label'),
  ('touch_outcome', 'Left Voicemail', 'voicemail', 'ASSUMED'),
  ('touch_outcome', 'Voicemail', 'voicemail', 'ASSUMED'),
  ('touch_outcome', 'Left Message', 'voicemail', 'ASSUMED'),
  ('touch_outcome', 'No Answer — no voicemail', 'no_answer', 'UI label'),
  ('touch_outcome', 'No Answer', 'no_answer', 'ASSUMED key'),
  ('touch_outcome', 'Gatekeeper — couldn''t get through', 'gatekeeper', 'UI label'),
  ('touch_outcome', 'Gatekeeper', 'gatekeeper', 'ASSUMED key'),
  ('touch_outcome', 'Not Interested', 'not_interested', 'UI label'),
  ('touch_outcome', 'Call Back Later', 'call_back_later', 'UI label'),
  ('touch_outcome', 'Scheduled — booked inspection', 'scheduled_inspection', 'UI label'),
  ('touch_outcome', 'Scheduled', 'scheduled_inspection', 'ASSUMED key'),
  ('touch_outcome', 'Inspection Booked', 'scheduled_inspection', 'ASSUMED'),
  ('touch_outcome', 'Bid Requested', 'bid_requested', 'ASSUMED'),
  ('touch_outcome', 'Bid Submitted', 'bid_submitted', 'UI label'),
  ('touch_outcome', 'Won', 'won', 'UI label'),
  ('touch_outcome', 'Lost', 'lost', 'UI label'),
  ('touch_outcome', 'Sent', 'sent', 'UI label'),
  ('touch_outcome', 'Got a Reply', 'replied', 'UI label'),
  ('touch_outcome', 'Replied', 'replied', 'ASSUMED key'),
  ('touch_outcome', 'Bounced', 'bounced', 'UI label'),
  ('touch_outcome', 'Met in Person', 'met_in_person', 'UI label'),
  ('touch_outcome', 'Met Decision Maker', 'met_decision_maker', 'ASSUMED'),
  ('touch_outcome', 'Not There', 'not_there', 'UI label'),
  ('touch_outcome', 'Auto-Reply', 'auto_reply', 'ASSUMED (Gmail out-of-office)'),
  ('touch_outcome', 'Out of Office', 'auto_reply', 'ASSUMED'),
  ('touch_outcome', 'Wrong Number', 'other', 'ASSUMED; V2 name kept in legacy_value'),
  ('touch_outcome', 'Other', 'other', 'ASSUMED'),
  ('touch_outcome', '<null>', 'other', 'touchpoint logged without an outcome'),
  ('touch_direction', 'outbound', 'outbound', 'V2 CHECK'), ('touch_direction', 'inbound', 'inbound', 'V2 CHECK'),
  ('touch_direction', '<null>', 'outbound', 'V2 default'),
  -- opportunity stages (UI labels; keys normalize to the same: inspection_scheduled = Inspection Scheduled)
  ('opp_stage', 'Lead', 'lead', 'UI label'),
  ('opp_stage', 'Contacted', 'contacted', 'UI label'),
  ('opp_stage', 'Inspection Scheduled', 'inspection_scheduled', 'UI label'),
  ('opp_stage', 'Inspection Complete', 'inspection_complete', 'UI label'),
  ('opp_stage', 'Inspection Completed', 'inspection_complete', 'ASSUMED'),
  ('opp_stage', 'Proposal Sent', 'proposal_sent', 'UI label'),
  ('opp_stage', 'Negotiation', 'negotiation', 'UI label'),
  ('opp_stage', 'Won', 'won', 'UI label'), ('opp_stage', 'Closed Won', 'won', 'ASSUMED'),
  ('opp_stage', 'Lost', 'lost', 'UI label'), ('opp_stage', 'Closed Lost', 'lost', 'ASSUMED'),
  -- opportunity status: won/lost override the stage (a deal lost at Proposal Sent is lost); open keeps the stage
  ('opp_status', 'open', null, 'V2 default'), ('opp_status', '<null>', null, null),
  ('opp_status', 'active', null, 'ASSUMED'), ('opp_status', 'on_hold', null, 'ASSUMED'),
  ('opp_status', 'won', 'won', 'ASSUMED'), ('opp_status', 'closed_won', 'won', 'ASSUMED'),
  ('opp_status', 'lost', 'lost', 'ASSUMED'), ('opp_status', 'closed_lost', 'lost', 'ASSUMED'),
  ('opp_status', 'cancelled', 'lost', 'ASSUMED'), ('opp_status', 'canceled', 'lost', 'ASSUMED'), ('opp_status', 'abandoned', 'lost', 'ASSUMED'),
  -- scope types -> service line (ASSUMED names; 9 rows in V2)
  ('scope_type', 'Repair', 'repair', 'ASSUMED'), ('scope_type', 'Roof Repair', 'repair', 'ASSUMED'), ('scope_type', 'Leak Repair', 'repair', 'ASSUMED'),
  ('scope_type', 'Re-Roof', 're_roof', 'ASSUMED'), ('scope_type', 'Reroof', 're_roof', 'ASSUMED'),
  ('scope_type', 'Replacement', 're_roof', 'ASSUMED'), ('scope_type', 'Roof Replacement', 're_roof', 'ASSUMED'),
  ('scope_type', 'Re-Cover', 're_cover', 'ASSUMED'), ('scope_type', 'Recover', 're_cover', 'ASSUMED'), ('scope_type', 'Overlay', 're_cover', 'ASSUMED'),
  ('scope_type', 'Maintenance', 'maintenance', 'ASSUMED'), ('scope_type', 'Preventive Maintenance', 'maintenance', 'ASSUMED'),
  ('scope_type', 'Inspection', 'inspection', 'ASSUMED'), ('scope_type', 'Roof Inspection', 'inspection', 'ASSUMED'),
  ('scope_type', 'Coating', 'coating', 'ASSUMED'), ('scope_type', 'Roof Coating', 'coating', 'ASSUMED'), ('scope_type', 'Restoration', 'coating', 'ASSUMED'),
  ('scope_type', 'Emergency', 'emergency', 'ASSUMED'), ('scope_type', 'Emergency Repair', 'emergency', 'ASSUMED'),
  ('scope_type', 'New Construction', 'new_construction', 'ASSUMED'),
  ('scope_type', 'Tenant Improvement', 'tenant_improvement', 'ASSUMED'),
  ('scope_type', 'Insurance Claim', 'insurance_claim', 'ASSUMED'), ('scope_type', 'Storm', 'insurance_claim', 'ASSUMED'),
  ('scope_type', 'Envelope', 'envelope', 'ASSUMED'), ('scope_type', 'Waterproofing', 'envelope', 'ASSUMED'),
  ('scope_type', 'Other', 'other', 'ASSUMED'),
  -- next action status -> task status (V2 default 'open'; the rest ASSUMED)
  ('task_status', 'open', 'open', 'V2 default'), ('task_status', '<null>', 'open', null),
  ('task_status', 'pending', 'open', 'ASSUMED'), ('task_status', 'snoozed', 'open', 'ASSUMED'), ('task_status', 'overdue', 'open', 'ASSUMED'),
  ('task_status', 'completed', 'done', 'ASSUMED'), ('task_status', 'complete', 'done', 'ASSUMED'), ('task_status', 'done', 'done', 'ASSUMED'),
  ('task_status', 'dismissed', 'dropped', 'ASSUMED'), ('task_status', 'cancelled', 'dropped', 'ASSUMED'), ('task_status', 'canceled', 'dropped', 'ASSUMED'),
  ('task_status', 'skipped', 'dropped', 'ASSUMED'), ('task_status', 'expired', 'dropped', 'ASSUMED'),
  -- property <-> account relationship (V2 CHECK, confirmed) -> property_party role
  ('party_role', 'owner', 'owner', 'V2 CHECK'),
  ('party_role', 'property_manager', 'manager', 'V2 CHECK'),
  ('party_role', 'gc', null, 'V2 CHECK; not an ownership party: kept in migration.legacy_value'),
  ('party_role', 'consultant', null, 'V2 CHECK; kept in migration.legacy_value'),
  ('party_role', 'vendor', null, 'V2 CHECK; kept in migration.legacy_value'),
  ('party_role', 'other', null, 'V2 CHECK; kept in migration.legacy_value')
on conflict (domain, legacy_key) do nothing;

-- Strict lookup used by every transform. Lookup-table values try the row's NAME first, then its KEY.
create or replace function migration.try_map(d text, v_name text, v_key text default null, out mapped boolean, out new_value text)
language plpgsql stable as $$
begin
  mapped := false;
  if nullif(btrim(v_name), '') is not null then
    select m.new_value into new_value from migration.value_map m where m.domain = d and m.legacy_key = migration.vkey(v_name);
    if found then mapped := true; return; end if;
  end if;
  if nullif(btrim(v_key), '') is not null then
    select m.new_value into new_value from migration.value_map m where m.domain = d and m.legacy_key = migration.vkey(v_key);
    if found then mapped := true; return; end if;
  end if;
  if nullif(btrim(v_name), '') is null and nullif(btrim(v_key), '') is null then
    select m.new_value into new_value from migration.value_map m where m.domain = d and m.legacy_key = '<null>';
    if found then mapped := true; return; end if;
  end if;
end $$;

create or replace function migration.map(d text, v_name text, v_key text default null) returns text language plpgsql stable as $$
declare r record;
begin
  r := migration.try_map(d, v_name, v_key);
  if not r.mapped then
    raise exception 'unmapped % value: name=% key=%', d, coalesce(v_name, '<null>'), coalesce(v_key, '<null>')
      using hint = 'add a row to the value maps in 02-preflight.sql and run it again';
  end if;
  return r.new_value;
end $$;

-- Test-data patterns from the V2 audit ("test 3 test 3", "123 Test 2", "address TBD").
create or replace function migration.looks_test(variadic vals text[]) returns boolean language sql immutable as $$
  select coalesce(bool_or(v ~* '(\mtest\M|\mTBD\M|^\s*123 test)'), false) from unnest(vals) v
$$;

-- Opportunity stage: a won/lost status wins over the stage the deal sat in (kept as legacy_value v2_stage).
create or replace function migration.opp_stage(v_status text, stage_name text, stage_key text) returns text language sql stable as
  $$ select coalesce(migration.map('opp_status', v_status), migration.map('opp_stage', stage_name, stage_key)) $$;

-- Record every legacy row whose actor (owner / creator / rep / assignee) has no NEW profile yet.
create or replace function migration.note_actors(view_name text, user_col text, role_col text, extra_where text default 'true') returns int
language plpgsql as $$
declare n int;
begin
  execute format($q$
    insert into migration.unmapped_actor as a (tenant_id, legacy_table, legacy_id, role_column, legacy_user_id, legacy_email)
    select migration.tenant_id(), v.legacy_table, v.legacy_id, %L, v.%I, m.email
      from legacy_v.%I v
      left join migration.user_map m on m.tenant_id = migration.tenant_id() and m.legacy_user_id = v.%I
     where migration.in_scope(v.org_id) and v.%I is not null and m.profile_id is null and (%s)
    on conflict (tenant_id, legacy_table, legacy_id, role_column) do update
       set legacy_user_id = excluded.legacy_user_id, legacy_email = excluded.legacy_email$q$,
    role_col, user_col, view_name, user_col, user_col, extra_where);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function migration.uid(legacy_user text) returns uuid language sql stable as
  $$ select profile_id from migration.user_map where tenant_id = migration.tenant_id() and legacy_user_id = legacy_user $$;

-- ------------------------------------------------------------------------------------------------- table dispositions
insert into migration.table_disposition(legacy_table, disposition, note) values
  ('orgs',                    'migrated',    'FOX org -> tenant fox (migration.settings fox_org_id); other orgs never read'),
  ('org_users',               'migrated',    'FOX users -> migration.user_map -> profile + membership, or invite'),
  ('profiles',                'migrated',    'full_name fallback for org_users'),
  ('memberships',             'migrated',    'users missing from org_users (role from roles.key)'),
  ('roles',                   'migrated',    'lookup for memberships.role_id'),
  ('accounts',                'migrated',    'public.account (+ account_preference, onboarding_status); soft-deleted rows stay in legacy'),
  ('account_assignments',     'migrated',    'first assignment -> account.owner_user_id, others -> account_assignment'),
  ('contacts',                'migrated',    'public.contact (+ contact_employment via trigger)'),
  ('properties',              'migrated',    'public.property; primary_account_id -> property_party'),
  ('property_accounts',       'migrated',    'owner / property_manager -> property_party (history kept); gc/consultant/vendor/other -> legacy_value'),
  ('property_contacts',       'migrated',    'public.property_contact (one row per property+contact; roles joined)'),
  ('property_assignments',    'migrated',    'property_pursuit (active) + account owner when the account has no assignment'),
  ('opportunities',           'migrated',    'public.opportunity'),
  ('opportunity_stages',      'migrated',    'lookup -> opportunity.stage'),
  ('opportunity_assignments', 'migrated',    'primary -> opportunity.owner_user_id'),
  ('lost_reason_types',       'migrated',    'lookup -> opportunity.lost_reason'),
  ('scope_types',             'migrated',    'lookup -> opportunity.service_line'),
  ('touchpoints',             'migrated',    'public.touch (source dillyv2: stamps freshness, closes tasks; no new tasks, no points)'),
  ('touchpoint_types',        'migrated',    'lookup -> touch.channel'),
  ('touchpoint_outcomes',     'migrated',    'lookup -> touch.outcome'),
  ('synced_emails',           'migrated',    'Gmail id on the linked touch (external_id gmail:<id>); matched emails with no touchpoint -> touch'),
  ('next_actions',            'migrated',    'public.task (closed by app.reconcile_tasks when a later touch exists)'),
  ('score_events',            'migrated',    'NOT migrated as points (recomputed); per-user total kept as legacy_points'),
  ('touchpoint_revisions',    'legacy_only', 'manager edit history of touchpoints; the edited (current) values are what migrate'),
  ('score_rules',             'legacy_only', 'V2 scoring rules; Dilly scores with point_rule'),
  ('streaks',                 'legacy_only', 'recomputed from touches by Dilly'),
  ('milestone_types',         'legacy_only', 'no milestones in V2 data'),
  ('opportunity_milestones',  'legacy_only', 'empty in V2'),
  ('kpi_definitions',         'legacy_only', 'Dilly has its own scorecard'),
  ('kpi_targets',             'legacy_only', 'Dilly has its own targets'),
  ('territories',             'legacy_only', 'territories become segment x rep assignment in Dilly'),
  ('territory_assignments',   'legacy_only', 'see territories'),
  ('territory_regions',       'legacy_only', 'see territories'),
  ('prospects',               'legacy_only', 'unworked lead lists; re-import through Accounts -> Import if wanted'),
  ('import_batches',          'legacy_only', 'V2 import bookkeeping'),
  ('suggested_outreach',      'legacy_only', 'V2 suggestions; Dilly ranks its own queue'),
  ('icp_profiles',            'legacy_only', 'ICP is recomputed by Dilly'),
  ('icp_criteria',            'legacy_only', 'ICP is recomputed by Dilly'),
  ('icp_feedback',            'legacy_only', 'ICP is recomputed by Dilly'),
  ('intel_entities',          'legacy_only', 'DillyIntel data, shared across orgs; not tenant data'),
  ('intel_properties',        'legacy_only', 'DillyIntel data'),
  ('intel_prospects',         'legacy_only', 'DillyIntel data'),
  ('intel_contacts',          'legacy_only', 'DillyIntel data'),
  ('intel_tenants',           'legacy_only', 'DillyIntel data'),
  ('agent_registry',          'legacy_only', 'V2 agents'),
  ('agent_runs',              'legacy_only', 'V2 agents'),
  ('benchmark_snapshots',     'legacy_only', 'V2 benchmarks'),
  ('merge_events',            'legacy_only', 'V2 merge audit'),
  ('email_connections',       'legacy_only', 'never migrated: Gmail tokens; reps re-connect in one tap'),
  ('org_invites',             'legacy_only', 'pending V2 invites; Dilly invites are created from org_users'),
  ('demo_requests',           'legacy_only', 'marketing site leads, not FOX data')
on conflict (legacy_table) do update set disposition = excluded.disposition, note = excluded.note;

-- ------------------------------------------------------------------------------------------------- canonical views
do $need$
declare v_missing text;
begin
  select string_agg(t, ', ') into v_missing from unnest(array[
    'orgs','org_users','profiles','memberships','roles','accounts','account_assignments','contacts','properties',
    'property_accounts','property_contacts','property_assignments','opportunities','opportunity_stages',
    'opportunity_assignments','lost_reason_types','scope_types','touchpoints','touchpoint_types','touchpoint_outcomes',
    'synced_emails','next_actions','score_events']) t
   where to_regclass('legacy.' || t) is null;
  if v_missing is not null then
    raise exception 'legacy copy is missing tables: % (run 01-connect-v2.sql)', v_missing;
  end if;
end $need$;

drop schema if exists legacy_v cascade;
create schema legacy_v;
comment on schema legacy_v is 'Canonical views over the raw Dilly V2 copy in schema legacy (source: migration/sql-editor/02-preflight.sql).';

-- Users of the FOX org: org_users (email, name, role), plus memberships-only users (role from roles.key).
create view legacy_v.users with (security_barrier) as
with u as (
  select ou.org_id, ou.user_id, ou.email, ou.full_name, ou.role, ou.created_at from legacy.org_users ou
  union all
  select m.org_id, m.user_id, null, null, r.key, m.created_at
    from legacy.memberships m left join legacy.roles r on r.id = m.role_id
   where not exists (select 1 from legacy.org_users ou where ou.org_id = m.org_id and ou.user_id = m.user_id)
)
select 'org_users'::text                                  as legacy_table,
       u.user_id::text                                    as legacy_id,
       u.org_id,
       nullif(lower(btrim(u.email)), '')                  as email,
       coalesce(nullif(btrim(u.full_name), ''), p.full_name) as full_name,
       u.role,
       (select sum(se.points) from legacy.score_events se where se.org_id = u.org_id and se.user_id = u.user_id)::text as legacy_points,
       u.created_at
  from u left join legacy.profiles p on p.user_id = u.user_id
 where migration.in_scope(u.org_id);

create view legacy_v.accounts with (security_barrier) as
select 'accounts'::text                  as legacy_table,
       a.id::text                        as legacy_id,
       a.org_id,
       a.name, a.account_type, a.status, a.onboarding_status, a.website, a.phone, a.city, a.state, a.notes,
       a.source                          as v2_source,
       a.primary_contact_id::text        as primary_contact_legacy_id,
       coalesce(aa.user_id, pa.user_id, case when cr.role = 'rep' then a.created_by end)::text as owner_legacy_user_id,
       case when aa.user_id is not null then 'account_assignments'
            when pa.user_id is not null then 'property_assignments'
            when cr.role = 'rep' then 'created_by (rep)' end as owner_source,
       a.created_by::text                as created_by_legacy_user_id,
       a.created_at, a.updated_at, a.deleted_at
  from legacy.accounts a
  left join lateral (select x.user_id from legacy.account_assignments x where x.account_id = a.id
                      order by x.assigned_at, x.id limit 1) aa on true
  left join lateral (select x.user_id from legacy.property_assignments x join legacy.properties p on p.id = x.property_id
                      where p.primary_account_id = a.id
                         or exists (select 1 from legacy.property_accounts y where y.property_id = p.id and y.account_id = a.id and y.active)
                      group by x.user_id order by count(*) desc, min(x.created_at), x.user_id limit 1) pa on true
  left join legacy.org_users cr on cr.org_id = a.org_id and cr.user_id = a.created_by
 where migration.in_scope(a.org_id);

-- Dilly has first/last name columns (full_name is generated from them). V2 requires full_name; first/last are
-- optional. When both are empty, full_name is split at the last space.
create view legacy_v.contacts with (security_barrier) as
select 'contacts'::text            as legacy_table,
       c.id::text                  as legacy_id,
       c.org_id,
       c.account_id::text          as account_legacy_id,
       c.full_name                 as v2_full_name,
       case when coalesce(nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')) is not null then nullif(btrim(c.first_name), '')
            when btrim(c.full_name) ~ '\s' then regexp_replace(btrim(c.full_name), '\s+\S+$', '')
            else nullif(btrim(c.full_name), '') end as first_name,
       case when coalesce(nullif(btrim(c.first_name), ''), nullif(btrim(c.last_name), '')) is not null then nullif(btrim(c.last_name), '')
            when btrim(c.full_name) ~ '\s' then substring(btrim(c.full_name) from '(\S+)$') end as last_name,
       c.title, c.email, c.phone, c.is_active, c.decision_role, c.priority_score,
       c.created_by::text          as created_by_legacy_user_id,
       c.created_at, c.updated_at, c.deleted_at
  from legacy.contacts c
 where migration.in_scope(c.org_id);

create view legacy_v.properties with (security_barrier) as
select 'properties'::text           as legacy_table,
       p.id::text                   as legacy_id,
       p.org_id,
       p.primary_account_id::text   as account_legacy_id,
       p.name,
       concat_ws(', ', nullif(btrim(p.address_line1), ''), nullif(btrim(p.address_line2), '')) as address1,
       p.city, p.state, p.postal_code as zip, p.country,
       nullif(lower(btrim(p.building_type)), '') as asset_class,
       nullif(btrim(p.roof_type), '') as roof_system,
       p.sq_footage::numeric         as roof_area_sf,
       case when p.roof_age_years between 0 and 150
            then (extract(year from coalesce(p.updated_at, p.created_at))::int - p.roof_age_years)::smallint end as roof_install_year,
       p.roof_age_years, p.external_ref, p.website, p.is_active, p.intel_property_id, p.notes,
       p.created_by::text            as created_by_legacy_user_id,
       p.created_at, p.updated_at, p.deleted_at
  from legacy.properties p
 where migration.in_scope(p.org_id);

-- Ownership / management links -> property_party rows. One row per V2 link (legacy_key), plus the property's
-- primary_account_id when no current link covers it (V2 quick-add stores the manager there).
--   disposition: ok | not_a_party (gc/consultant/vendor/other) | extra_current (a 2nd current link for the same role)
--                | primary_unplaced (both roles already taken by other accounts)
create view legacy_v.property_parties with (security_barrier) as
with pa as (
  select x.*, (migration.try_map('party_role', x.relationship_type)).new_value as role,
         x.active and (x.ends_on is null or x.ends_on > current_date) as is_current
    from legacy.property_accounts x
   where migration.in_scope(x.org_id)
), ranked as (
  select pa.*, row_number() over (partition by pa.property_id, pa.role, pa.is_current
                                  order by pa.is_primary desc, pa.starts_on desc nulls last, pa.created_at desc, pa.id) as rn
    from pa
), first_snap as (
  select coalesce(max(taken_at)::date, current_date) as d from migration.snapshot where kind = 'full'
)
select 'property_accounts:' || r.id    as legacy_key,
       'property_accounts'::text       as legacy_table,
       r.id::text                      as legacy_id,
       r.org_id,
       r.property_id::text             as property_legacy_id,
       r.account_id::text              as account_legacy_id,
       r.relationship_type,
       r.role,
       r.starts_on                     as started_on,
       case when r.is_current then null else greatest(coalesce(r.ends_on, (select d from first_snap)), r.starts_on) end as ended_on,
       case when r.role is null then 'not_a_party'
            when r.is_current and r.rn > 1 then 'extra_current'
            else 'ok' end              as disposition
  from ranked r
union all
select 'properties.primary_account_id:' || p.id,
       'properties', p.id::text, p.org_id, p.id::text, p.primary_account_id::text, 'primary_account_id',
       case when not exists (select 1 from ranked r where r.property_id = p.id and r.is_current and r.role = 'manager' and r.rn = 1) then 'manager'
            when not exists (select 1 from ranked r where r.property_id = p.id and r.is_current and r.role = 'owner' and r.rn = 1) then 'owner' end,
       null::date, null::date,
       case when exists (select 1 from ranked r where r.property_id = p.id and r.is_current and r.role = 'manager' and r.rn = 1)
             and exists (select 1 from ranked r where r.property_id = p.id and r.is_current and r.role = 'owner' and r.rn = 1)
            then 'primary_unplaced' else 'ok' end
  from legacy.properties p
 where p.primary_account_id is not null and migration.in_scope(p.org_id)
   and not exists (select 1 from pa where pa.property_id = p.id and pa.account_id = p.primary_account_id and pa.is_current);

-- property_contacts PK is (property, contact, role_category): Dilly keeps one link per (property, contact).
create view legacy_v.property_contacts with (security_barrier) as
select 'property_contacts'::text                                       as legacy_table,
       pc.property_id::text || ':' || pc.contact_id::text || ':' || pc.role_category as legacy_id,
       pc.org_id,
       pc.property_id::text                                            as property_legacy_id,
       pc.contact_id::text                                             as contact_legacy_id,
       coalesce(nullif(btrim(pc.role_label), ''), replace(pc.role_category, '_', ' ')) as role,
       pc.role_category, pc.is_primary, pc.active, pc.priority_rank
  from legacy.property_contacts pc
 where migration.in_scope(pc.org_id);

create view legacy_v.opportunities with (security_barrier) as
select 'opportunities'::text           as legacy_table,
       o.id::text                      as legacy_id,
       o.org_id,
       o.account_id::text              as account_legacy_id,
       o.property_id::text             as property_legacy_id,
       o.primary_contact_id::text      as contact_legacy_id,
       o.title                         as name,
       st.key as scope_key, st.name as scope_name,
       sg.key as stage_key, sg.name as stage_name,
       o.status,
       coalesce(o.final_value, o.bid_value, o.estimated_value) as value,
       o.estimated_value, o.bid_value, o.final_value,
       lr.name                         as lost_reason_name,
       o.lost_notes, o.created_reason,
       o.created_from_touchpoint_id::text as created_from_touchpoint_legacy_id,
       oa.user_id::text                as owner_legacy_user_id,
       o.created_by::text              as created_by_legacy_user_id,
       o.opened_at, o.closed_at, o.created_at, o.updated_at, o.deleted_at
  from legacy.opportunities o
  left join legacy.scope_types st on st.id = o.scope_type_id
  left join legacy.opportunity_stages sg on sg.id = o.stage_id
  left join legacy.lost_reason_types lr on lr.id = o.lost_reason_type_id
  left join lateral (select x.user_id from legacy.opportunity_assignments x where x.opportunity_id = o.id
                      order by x.is_primary desc, (x.assignment_role = 'primary_rep') desc, x.created_at, x.id limit 1) oa on true
 where migration.in_scope(o.org_id);

-- Every touch that migrates: V2 touchpoints, plus Gmail messages V2 synced and matched to a contact but never
-- logged as a touchpoint (synced_emails.touchpoint_id null) and not already represented by an email touchpoint on
-- the same contact within 10 minutes. Emails with a touchpoint only contribute their Gmail id (no double count).
-- The account is the touchpoint's, else the contact's, else the property's (same rule as Dilly's touch trigger).
create view legacy_v.touches with (security_barrier) as
select 'touchpoints'::text             as legacy_table,
       t.id::text                      as legacy_id,
       t.org_id,
       t.rep_user_id::text             as actor_legacy_user_id,
       coalesce(t.account_id, c.account_id, p.primary_account_id)::text as account_legacy_id,
       t.contact_id::text              as contact_legacy_id,
       t.property_id::text             as property_legacy_id,
       t.opportunity_id::text          as opportunity_legacy_id,
       ty.key as type_key, ty.name as type_name,
       oc.key as outcome_key, oc.name as outcome_name,
       t.direction, t.engagement_phase, t.notes,
       t.happened_at                   as occurred_at,
       t.created_at, t.updated_at,
       se.gmail_message_id, se.thread_id as gmail_thread_id, se.subject as email_subject
  from legacy.touchpoints t
  left join legacy.contacts c on c.id = t.contact_id
  left join legacy.properties p on p.id = t.property_id
  left join legacy.touchpoint_types ty on ty.id = t.touchpoint_type_id
  left join legacy.touchpoint_outcomes oc on oc.id = t.outcome_id
  left join lateral (select s.gmail_message_id, s.thread_id, s.subject from legacy.synced_emails s
                      where s.touchpoint_id = t.id order by s.message_ts, s.id limit 1) se on true
 where migration.in_scope(t.org_id)
union all
select 'synced_emails', s.id::text, s.org_id, s.user_id::text,
       c.account_id::text, s.matched_contact_id::text, null, null,
       'email', 'Email', null, case s.direction when 'inbound' then 'Got a Reply' else 'Sent' end,
       s.direction, null,
       nullif('Email: ' || coalesce(nullif(btrim(s.subject), ''), ''), 'Email: '),
       s.message_ts, s.created_at, s.created_at,
       s.gmail_message_id, s.thread_id, s.subject
  from legacy.synced_emails s
  join legacy.contacts c on c.id = s.matched_contact_id
 where s.touchpoint_id is null and migration.in_scope(s.org_id)
   and not exists (select 1 from legacy.touchpoints t2 join legacy.touchpoint_types ty2 on ty2.id = t2.touchpoint_type_id
                    where t2.contact_id = s.matched_contact_id
                      and (migration.try_map('touch_type', ty2.name, ty2.key)).new_value = 'email'
                      and t2.happened_at between s.message_ts - interval '10 minutes' and s.message_ts + interval '10 minutes');

-- Follow-ups. V2 stores due_at (timestamptz): due date = its calendar day in the tenant's time zone.
create view legacy_v.follow_ups with (security_barrier) as
select 'next_actions'::text                   as legacy_table,
       n.id::text                             as legacy_id,
       n.org_id,
       n.assigned_user_id::text               as assignee_legacy_user_id,
       coalesce(n.account_id, c.account_id)::text as account_legacy_id,
       n.contact_id::text                     as contact_legacy_id,
       n.property_id::text                    as property_legacy_id,
       n.opportunity_id::text                 as opportunity_legacy_id,
       ty.key as type_key, ty.name as type_name,
       n.due_at,
       (n.due_at at time zone coalesce((select timezone from public.tenant where id = migration.tenant_id()), 'America/Chicago'))::date as due_on,
       n.status, n.notes, n.dismiss_reason, n.snoozed_count, n.last_snoozed_at,
       n.created_from_touchpoint_id::text     as created_from_touchpoint_legacy_id,
       n.completed_by_touchpoint_id::text     as completed_by_touchpoint_legacy_id,
       c.full_name                            as contact_name,
       n.created_by::text                     as created_by_legacy_user_id,
       n.created_at, n.updated_at
  from legacy.next_actions n
  left join legacy.contacts c on c.id = n.contact_id
  left join legacy.touchpoint_types ty on ty.id = n.recommended_touchpoint_type_id
 where migration.in_scope(n.org_id);

-- Every canonical view above holds FOX rows only (security_barrier: no other org's row ever reaches a map() call).
-- Every value that must map, in scope, with where it comes from and how many rows use it.
create view legacy_v.value_usage as
select 'account_type' as domain, account_type as name, null::text as key, 'accounts.account_type' as source_column, count(*) as rows
  from legacy_v.accounts where migration.in_scope(org_id) and deleted_at is null group by 2
union all select 'account_status', status, null, 'accounts.status', count(*) from legacy_v.accounts where migration.in_scope(org_id) and deleted_at is null group by 2
union all select 'onboarding_status', onboarding_status, null, 'accounts.onboarding_status', count(*) from legacy_v.accounts where migration.in_scope(org_id) and deleted_at is null group by 2
union all select 'user_role', role, null, 'org_users.role / roles.key', count(*) from legacy_v.users where migration.in_scope(org_id) group by 2
union all select 'decision_role', decision_role, null, 'contacts.decision_role', count(*) from legacy_v.contacts where migration.in_scope(org_id) and deleted_at is null group by 2
union all select 'touch_type', type_name, type_key, legacy_table || ' -> touchpoint_types', count(*) from legacy_v.touches where migration.in_scope(org_id) group by 2, 3, 4
union all select 'touch_outcome', outcome_name, outcome_key, legacy_table || ' -> touchpoint_outcomes', count(*) from legacy_v.touches where migration.in_scope(org_id) group by 2, 3, 4
union all select 'touch_direction', direction, null, legacy_table || '.direction', count(*) from legacy_v.touches where migration.in_scope(org_id) group by 2, 4
union all select 'opp_stage', stage_name, stage_key, 'opportunities -> opportunity_stages', count(*) from legacy_v.opportunities where migration.in_scope(org_id) and deleted_at is null group by 2, 3
union all select 'opp_status', status, null, 'opportunities.status', count(*) from legacy_v.opportunities where migration.in_scope(org_id) and deleted_at is null group by 2
union all select 'scope_type', scope_name, scope_key, 'opportunities -> scope_types', count(*) from legacy_v.opportunities where migration.in_scope(org_id) and deleted_at is null group by 2, 3
union all select 'task_status', status, null, 'next_actions.status', count(*) from legacy_v.follow_ups where migration.in_scope(org_id) group by 2
union all select 'party_role', relationship_type, null, 'property_accounts.relationship_type', count(*) from legacy.property_accounts where migration.in_scope(org_id) group by 2;

-- ------------------------------------------------------------------------------------------------- preflight
create or replace function migration.preflight() returns void language plpgsql as $$
declare
  problems text[] := '{}';
  r record;
  ok boolean;
  n bigint;
begin
  if migration.tenant_id() is null then
    problems := problems || format('tenant %s does not exist in public.tenant (run supabase db push first)', coalesce(migration.setting('tenant_slug'), 'fox'));
  end if;
  if migration.fox_org() is null or not exists (select 1 from legacy.orgs where id = migration.fox_org()) then
    problems := problems || 'FOX org not selected: run 02-preflight.sql'::text;
  end if;

  -- 1) unmapped values: all of them, with the column they come from and how many rows use them
  for r in select u.* from legacy_v.value_usage u
            where not (migration.try_map(u.domain, u.name, u.key)).mapped order by u.domain, u.rows desc loop
    problems := problems || format('unmapped %s value %s%s (%s, %s rows)', r.domain,
                  coalesce(quote_literal(r.name), '<null>'), coalesce(' [key ' || quote_literal(r.key) || ']', ''), r.source_column, r.rows);
  end loop;

  -- 2) map targets must be valid Dilly codes
  for r in select m.domain, m.legacy_value, m.new_value, d.target_type, d.allow_null
             from migration.value_map m join migration.value_domain d using (domain) loop
    if r.new_value is null then
      if not r.allow_null then
        problems := problems || format('value map %s %L maps to NULL but the domain does not allow it', r.domain, r.legacy_value);
      end if;
      continue;
    end if;
    if r.target_type like 'one_of:%' then
      ok := r.new_value = any (string_to_array(substr(r.target_type, 8), ','));
    else
      begin
        execute format('select %L::%s', r.new_value, r.target_type);
        ok := true;
      exception when others then ok := false;
      end;
    end if;
    if not ok then
      problems := problems || format('value map %s %L -> %L is not a valid %s', r.domain, r.legacy_value, r.new_value, r.target_type);
    end if;
  end loop;

  -- 3) user ids unique in scope (org_users + memberships union)
  select count(*) - count(distinct legacy_id) into n from legacy_v.users where migration.in_scope(org_id);
  if n > 0 then problems := problems || format('legacy_v.users has %s duplicate user ids', n); end if;

  -- 4) every copied table is classified
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'legacy' and c.relkind = 'r' and c.relname !~ '^_'
              and not exists (select 1 from migration.table_disposition d where d.legacy_table = c.relname)
            order by 1 loop
    problems := problems || format('V2 table %s has no disposition (add it to migration.table_disposition in 02-preflight.sql)', r.relname);
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception E'migration preflight failed (% problems):\n  - %', array_length(problems, 1), array_to_string(problems, E'\n  - ')
      using hint = 'Fix the value maps in 02-preflight.sql and run it again. Nothing in public.* was written.';
  end if;

  -- Non-blocking notes
  select count(*) into n from legacy_v.users where migration.in_scope(org_id) and email is null;
  if n > 0 then raise notice 'preflight: % V2 users have no email; their rows migrate with empty user columns (migration.unmapped_actor)', n; end if;
  raise notice 'preflight passed';
end $$;

do $run$ begin perform migration.preflight(); end $run$;

-- Never expose bookkeeping or the raw copy through the API roles.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema migration, legacy_v, legacy from anon';
    execute 'revoke all on all tables in schema legacy_v from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on schema migration, legacy_v, legacy from authenticated';
    execute 'revoke all on all tables in schema legacy_v from authenticated';
  end if;
end $$;

insert into migration.run_log(step, detail) values ('preflight', jsonb_build_object('ok', true, 'fox_org_id', migration.fox_org()));

-- Result: what 03-transform.sql will load.
select 'preflight' as check, 'PASS — run 03-transform.sql next' as value
union all select 'FOX org in V2', migration.fox_org() || '  ' || (select name from legacy.orgs where id = migration.fox_org())
union all select 'Dilly tenant', coalesce(migration.setting('tenant_slug'), 'fox') || '  ' || coalesce(migration.tenant_id()::text, 'MISSING')
union all select 'users', (select count(*) from legacy_v.users where migration.in_scope(org_id))::text
union all select 'accounts (+ soft-deleted, not migrated)', (select count(*) filter (where deleted_at is null) || ' (+' || count(*) filter (where deleted_at is not null) || ')' from legacy_v.accounts where migration.in_scope(org_id))
union all select 'contacts (+ soft-deleted)', (select count(*) filter (where deleted_at is null) || ' (+' || count(*) filter (where deleted_at is not null) || ')' from legacy_v.contacts where migration.in_scope(org_id))
union all select 'properties (+ soft-deleted)', (select count(*) filter (where deleted_at is null) || ' (+' || count(*) filter (where deleted_at is not null) || ')' from legacy_v.properties where migration.in_scope(org_id))
union all select 'opportunities (+ soft-deleted)', (select count(*) filter (where deleted_at is null) || ' (+' || count(*) filter (where deleted_at is not null) || ')' from legacy_v.opportunities where migration.in_scope(org_id))
union all select 'touches (touchpoints + unlogged synced emails)', (select count(*) filter (where legacy_table = 'touchpoints') || ' + ' || count(*) filter (where legacy_table = 'synced_emails') from legacy_v.touches where migration.in_scope(org_id))
union all select 'follow-ups (next_actions)', (select count(*) from legacy_v.follow_ups where migration.in_scope(org_id))::text
union all select 'other V2 orgs (not migrated)', (select count(*) from legacy.orgs where id <> migration.fox_org())::text;
