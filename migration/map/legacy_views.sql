-- legacy_views.sql — THE ONLY FILE THAT KNOWS REAL DILLY V2 TABLE AND COLUMN NAMES.
--
-- Every transform in migration/map/NN_*.sql reads legacy_v.<canonical view>, never legacy.* directly.
-- The V2 schema is not available yet, so the names on the right-hand side below are a BEST GUESS from the
-- Sep 13, 2026 app review. When discovery (02-discover.sh -> legacy-schema.md) shows different names, edit
-- ONLY this file: keep the canonical output column names (left-hand aliases) and change the expressions.
--
-- Conventions
--   legacy_table  real V2 table name, stored on every migrated row (public.*.legacy_table)
--   legacy_id     V2 primary key as text (composite keys joined with ':')
--   org_id        V2 organization id as text (scoped by migration.config legacy_org_id)
--   *_legacy_id   foreign keys as text; *_legacy_user_id actors as text
--   timestamps    timestamptz. If V2 stores `timestamp without time zone`, wrap as  (col at time zone 'UTC')
--
-- Every column marked  -- ASSUMED  must be confirmed (see README "Assumptions to confirm").

drop schema if exists legacy_v cascade;
create schema legacy_v;
comment on schema legacy_v is 'Canonical views over the raw Dilly V2 copy in schema legacy (edit migration/map/legacy_views.sql only).';

insert into migration.entity(canonical, legacy_table, target_table) values
  ('organizations',     'organizations',     'tenant'),
  ('users',             'profiles',          'profile'),          -- ASSUMED table name (could be "users")
  ('accounts',          'accounts',          'account'),
  ('contacts',          'contacts',          'contact'),
  ('properties',        'properties',        'property'),
  ('property_contacts', 'property_contacts', 'property_contact'), -- ASSUMED join table (could be contacts.property_id)
  ('opportunities',     'opportunities',     'opportunity'),
  ('touchpoints',       'touchpoints',       'touch'),
  ('follow_ups',        'follow_ups',        'task')             -- ASSUMED table name (could be "tasks")
on conflict (canonical) do update set legacy_table = excluded.legacy_table, target_table = excluded.target_table;

-- Tables restored into `legacy` that are deliberately NOT transformed (they stay queryable in legacy forever).
insert into migration.table_disposition(legacy_table, disposition, note) values
  ('organizations',     'migrated',    'FOX org -> tenant fox (config tenant_slug); id used for scoping only'),
  ('profiles',          'migrated',    'users -> migration.user_map -> profile/membership or invite'),
  ('accounts',          'migrated',    'public.account (+ account_preference, onboarding_status)'),
  ('contacts',          'migrated',    'public.contact'),
  ('properties',        'migrated',    'public.property'),
  ('property_contacts', 'migrated',    'public.property_contact'),
  ('opportunities',     'migrated',    'public.opportunity'),
  ('touchpoints',       'migrated',    'public.touch (source dillyv2: stamps freshness, closes tasks, no points/new tasks)'),
  ('follow_ups',        'migrated',    'public.task (closed by app.reconcile_tasks when a later touch exists)'),
  ('territories',       'legacy_only', 'Territories become segment x rep assignment in the new app; recreated by hand'),
  ('prospects',         'legacy_only', 'Empty at review time; prospects come from List-Build/Signal ingest in the new app'),
  ('gmail_tokens',      'legacy_only', 'Never migrated: new OAuth client, reps re-consent in one tap')
on conflict (legacy_table) do update set disposition = excluded.disposition, note = excluded.note;

-- ---------------------------------------------------------------------------------------------- users
create view legacy_v.users as
select migration.lt('users')        as legacy_table,
       u.id::text                   as legacy_id,
       u.org_id::text               as org_id,
       lower(btrim(u.email::text))  as email,
       u.full_name                  as full_name,
       u.role::text                 as role,          -- rep | manager | admin
       u.points::text               as legacy_points, -- ASSUMED: leaderboard total on the profile
       u.created_at                 as created_at
  from legacy.profiles u;

-- ---------------------------------------------------------------------------------------------- accounts
create view legacy_v.accounts as
select migration.lt('accounts')     as legacy_table,
       a.id::text                   as legacy_id,
       a.org_id::text               as org_id,
       a.name                       as name,
       a.type::text                 as account_type,       -- ASSUMED column name "type"
       a.website                    as website,
       a.phone                      as phone,
       a.address                    as address1,           -- ASSUMED
       a.city, a.state, a.zip,
       a.priority::text             as priority,           -- P1..P4
       a.score::text                as legacy_score,       -- ASSUMED; kept, not used (score is recomputed)
       a.onboarding_status::text    as onboarding_status,
       a.status::text               as status,             -- ASSUMED: active / do_not_pursue / existing_client
       a.assigned_to::text          as owner_legacy_user_id,  -- ASSUMED column name "assigned_to"
       a.created_by::text           as created_by_legacy_user_id,
       a.notes                      as notes,
       a.created_at                 as created_at,
       a.updated_at                 as updated_at
  from legacy.accounts a;

-- ---------------------------------------------------------------------------------------------- contacts
create view legacy_v.contacts as
select migration.lt('contacts')     as legacy_table,
       c.id::text                   as legacy_id,
       c.org_id::text               as org_id,
       c.account_id::text           as account_legacy_id,
       c.first_name, c.last_name, c.title,
       c.email::text                as email,
       c.phone                      as phone,
       c.mobile                     as mobile,             -- ASSUMED
       c.notes                      as notes,
       c.created_by::text           as created_by_legacy_user_id,
       c.created_at, c.updated_at
  from legacy.contacts c;

-- ---------------------------------------------------------------------------------------------- properties
create view legacy_v.properties as
select migration.lt('properties')   as legacy_table,
       p.id::text                   as legacy_id,
       p.org_id::text               as org_id,
       p.account_id::text           as account_legacy_id,  -- ASSUMED: direct account link on the property
       p.name                       as name,
       p.address                    as address1,
       p.city, p.state, p.zip,
       lower(p.property_type)       as asset_class,        -- ASSUMED column name
       p.roof_type                  as roof_system,        -- ASSUMED column name
       p.sqft::numeric              as roof_area_sf,       -- ASSUMED column name
       p.buildings::int             as building_count,     -- ASSUMED column name
       p.notes                      as notes,
       p.created_by::text           as created_by_legacy_user_id,
       p.created_at, p.updated_at
  from legacy.properties p;

-- ---------------------------------------------------------------------------------------------- property <-> contact
create view legacy_v.property_contacts as
select migration.lt('property_contacts')            as legacy_table,
       pc.property_id::text || ':' || pc.contact_id::text as legacy_id,
       pc.property_id::text                          as property_legacy_id,
       pc.contact_id::text                           as contact_legacy_id,
       pc.role                                       as role
  from legacy.property_contacts pc;

-- ---------------------------------------------------------------------------------------------- opportunities
create view legacy_v.opportunities as
select migration.lt('opportunities') as legacy_table,
       o.id::text                    as legacy_id,
       o.org_id::text                as org_id,
       o.account_id::text            as account_legacy_id,
       o.property_id::text           as property_legacy_id,
       o.contact_id::text            as contact_legacy_id,   -- ASSUMED
       o.name                        as name,
       o.type::text                  as opp_type,            -- ASSUMED: service type
       o.stage::text                 as stage,
       o.value::numeric              as value,               -- ASSUMED column name "value"
       o.notes                       as notes,
       o.assigned_to::text           as owner_legacy_user_id,
       o.created_by::text            as created_by_legacy_user_id,
       o.stage_updated_at            as stage_changed_at,    -- ASSUMED
       o.created_at, o.updated_at
  from legacy.opportunities o;

-- ---------------------------------------------------------------------------------------------- touchpoints
create view legacy_v.touchpoints as
select migration.lt('touchpoints')  as legacy_table,
       t.id::text                   as legacy_id,
       t.org_id::text               as org_id,
       t.account_id::text           as account_legacy_id,
       t.contact_id::text           as contact_legacy_id,
       t.property_id::text          as property_legacy_id,
       t.opportunity_id::text       as opportunity_legacy_id,  -- ASSUMED
       t.user_id::text              as actor_legacy_user_id,   -- ASSUMED column name "user_id"
       t.type::text                 as touch_type,
       t.outcome::text              as outcome,
       t.direction::text            as direction,
       t.source::text               as touch_source,           -- ASSUMED: 'manual' | 'gmail'
       t.gmail_message_id           as gmail_message_id,       -- ASSUMED
       t.gmail_thread_id            as gmail_thread_id,        -- ASSUMED
       t.notes                      as notes,
       t.points::text               as legacy_points,          -- ASSUMED
       t.created_at                 as occurred_at,            -- ASSUMED: V2 uses created_at as the touch time
       t.created_at                 as created_at,
       t.updated_at                 as updated_at
  from legacy.touchpoints t;

-- ---------------------------------------------------------------------------------------------- follow-ups
create view legacy_v.follow_ups as
select migration.lt('follow_ups')   as legacy_table,
       f.id::text                   as legacy_id,
       f.org_id::text               as org_id,
       f.account_id::text           as account_legacy_id,
       f.contact_id::text           as contact_legacy_id,
       f.property_id::text          as property_legacy_id,
       f.touchpoint_id::text        as touchpoint_legacy_id,   -- ASSUMED
       f.assigned_to::text          as assignee_legacy_user_id,
       f.title                      as title,
       f.notes                      as notes,
       f.due_date::date             as due_on,
       f.status::text               as status,
       coalesce(f.snooze_count, 0)::int as snooze_count,       -- ASSUMED
       f.completed_at               as completed_at,
       f.created_at, f.updated_at
  from legacy.follow_ups f;

-- ---------------------------------------------------------------------------------------------- value usage
-- Every enum-like value in scope, per mapping domain. 05_preflight checks each against migration.value_map.
create view legacy_v.value_usage as
select 'account_type' as domain, account_type as value, 'accounts.type' as source_column, count(*) as rows
  from legacy_v.accounts where migration.in_scope(org_id) group by 2
union all select 'account_status', status, 'accounts.status', count(*) from legacy_v.accounts where migration.in_scope(org_id) group by 2
union all select 'icp_priority', priority, 'accounts.priority', count(*) from legacy_v.accounts where migration.in_scope(org_id) group by 2
union all select 'onboarding_status', onboarding_status, 'accounts.onboarding_status', count(*) from legacy_v.accounts where migration.in_scope(org_id) group by 2
union all select 'user_role', role, 'profiles.role', count(*) from legacy_v.users where migration.in_scope(org_id) group by 2
union all select 'touch_type', touch_type, 'touchpoints.type', count(*) from legacy_v.touchpoints where migration.in_scope(org_id) group by 2
union all select 'touch_outcome', outcome, 'touchpoints.outcome', count(*) from legacy_v.touchpoints where migration.in_scope(org_id) group by 2
union all select 'touch_direction', direction, 'touchpoints.direction', count(*) from legacy_v.touchpoints where migration.in_scope(org_id) group by 2
union all select 'touch_source', touch_source, 'touchpoints.source', count(*) from legacy_v.touchpoints where migration.in_scope(org_id) group by 2
union all select 'opp_stage', stage, 'opportunities.stage', count(*) from legacy_v.opportunities where migration.in_scope(org_id) group by 2
union all select 'opp_type', opp_type, 'opportunities.type', count(*) from legacy_v.opportunities where migration.in_scope(org_id) group by 2
union all select 'task_status', status, 'follow_ups.status', count(*) from legacy_v.follow_ups where migration.in_scope(org_id) group by 2;

-- In-scope property links: a link is in scope when its property is.
create view legacy_v.property_contacts_in_scope as
select pc.* from legacy_v.property_contacts pc
  join legacy_v.properties p on p.legacy_id = pc.property_legacy_id
 where migration.in_scope(p.org_id);

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema legacy_v from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema legacy_v from authenticated'; end if;
end $$;
