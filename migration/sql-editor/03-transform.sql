-- =====================================================================================================================
-- 03-transform.sql — run in the NEW Dilly project AFTER 02-preflight.sql passed. Safe to re-run (idempotent).
--
-- legacy.* (FOX org only) -> public.*, in ONE transaction: if anything fails, nothing is written.
-- Every row keeps source='dillyv2', legacy_table, legacy_id; upserts are keyed on (tenant_id, legacy_table, legacy_id).
-- Runs migration.preflight() first: an unmapped value stops everything before a single row is written.
-- Order: users -> accounts -> contacts -> properties -> ownership/management (property_party) -> property contacts
--        -> property assignments (pursuit) -> opportunities -> touches -> follow-ups -> preferences
--        -> re-attribution -> app.reconcile_tasks -> duplicate suggestions.
-- Migrated touches (source dillyv2) only stamp freshness and close tasks: no new tasks, no points.
-- Result: one table "entity / rows". Next: 04-reconcile.sql.
-- =====================================================================================================================

set statement_timeout = 0;

do $transform$
#variable_conflict use_column
declare
  v_t      uuid;
  v_today  date;
  v_id     uuid;
  v_n      int;
  r        record;
begin
  perform migration.preflight();
  v_t := migration.tenant_id();
  v_today := app.tenant_today(v_t);

  -- ============================================================================================ 1. people
  insert into migration.user_map as m (tenant_id, legacy_table, legacy_user_id, email, full_name, legacy_role, new_role, updated_at)
  select v_t, u.legacy_table, u.legacy_id, u.email, u.full_name, u.role, migration.map('user_role', u.role), now()
    from legacy_v.users u
   where migration.in_scope(u.org_id)
  on conflict (tenant_id, legacy_user_id) do update
     set email = excluded.email, full_name = excluded.full_name, legacy_role = excluded.legacy_role,
         new_role = excluded.new_role, legacy_table = excluded.legacy_table, updated_at = now();

  -- People who already signed in to Dilly (same email, case-insensitive).
  update migration.user_map m set profile_id = p.id, updated_at = now()
    from public.profile p
   where m.tenant_id = v_t and m.email is not null and lower(p.email::text) = m.email and m.profile_id is distinct from p.id;

  -- Signed in: make sure they are members (never downgrade an existing membership).
  insert into public.membership(tenant_id, user_id, role)
  select m.tenant_id, m.profile_id, m.new_role from migration.user_map m
   where m.tenant_id = v_t and m.profile_id is not null
  on conflict (tenant_id, user_id) do nothing;

  -- Not signed in yet: invite (an existing invite for the email, e.g. the seeded FOX roster, is kept as is).
  insert into public.invite(tenant_id, email, role, full_name)
  select m.tenant_id, m.email, m.new_role, m.full_name from migration.user_map m
   where m.tenant_id = v_t and m.profile_id is null and m.email is not null
  on conflict (tenant_id, email) do nothing;

  update migration.user_map m set invite_id = i.id
    from public.invite i
   where m.tenant_id = v_t and i.tenant_id = m.tenant_id and lower(i.email::text) = m.email and m.invite_id is distinct from i.id;

  -- V2 points are not migrated (recomputed by Dilly); each person's V2 total is kept for comparison.
  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'profile', m.profile_id, u.legacy_table, u.legacy_id, 'legacy_points', u.legacy_points
    from legacy_v.users u join migration.user_map m on m.tenant_id = v_t and m.legacy_user_id = u.legacy_id
   where migration.in_scope(u.org_id) and u.legacy_points is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  -- Actors seen in an earlier run who have signed in since.
  update migration.unmapped_actor a set resolved_profile_id = m.profile_id
    from migration.user_map m
   where a.tenant_id = m.tenant_id and a.tenant_id = v_t and a.legacy_user_id = m.legacy_user_id
     and m.profile_id is not null and a.resolved_profile_id is distinct from m.profile_id;

  -- ============================================================================================ 2. accounts
  -- icp_tier stays at the Dilly default (V2 has no P1-P4 column); score is recomputed by Dilly.
  -- Onboarding is set on insert so the scorecard does not count it as paperwork received today.
  insert into public.account as x (
    tenant_id, name, account_type, website, phone, city, state, onboarding_status, owner_user_id, notes,
    source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
  select v_t,
         coalesce(nullif(btrim(a.name), ''), '(unnamed Dilly V2 account ' || a.legacy_id || ')'),
         migration.map('account_type', a.account_type),
         a.website, a.phone, a.city, a.state,
         migration.map('onboarding_status', a.onboarding_status),
         migration.uid(a.owner_legacy_user_id),
         a.notes,
         'dillyv2', a.legacy_table, a.legacy_id,
         migration.looks_test(a.name, a.notes),
         migration.uid(a.created_by_legacy_user_id),
         a.created_at, a.updated_at
    from legacy_v.accounts a
   where migration.in_scope(a.org_id) and a.deleted_at is null
   order by a.created_at, a.legacy_id
  on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
    name              = excluded.name,
    account_type      = excluded.account_type,
    website           = excluded.website,
    phone             = excluded.phone,
    city              = excluded.city,
    state             = excluded.state,
    onboarding_status = excluded.onboarding_status,
    owner_user_id     = coalesce(excluded.owner_user_id, x.owner_user_id),
    notes             = excluded.notes,
    is_test           = excluded.is_test,
    created_by        = coalesce(excluded.created_by, x.created_by),
    created_at        = excluded.created_at;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'account', x.id, a.legacy_table, a.legacy_id, f.field, f.value
    from legacy_v.accounts a
    join public.account x on x.tenant_id = v_t and x.legacy_table = a.legacy_table and x.legacy_id = a.legacy_id
   cross join lateral (values ('v2_account_type', a.account_type), ('v2_status', a.status), ('v2_source', a.v2_source),
                              ('v2_onboarding_status', a.onboarding_status), ('owner_source', a.owner_source),
                              ('v2_primary_contact_id', a.primary_contact_legacy_id)) f(field, value)
   where migration.in_scope(a.org_id) and f.value is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, a.legacy_table, a.legacy_id, f.flag, f.detail
    from legacy_v.accounts a
   cross join lateral (values
     (case when a.deleted_at is null and migration.looks_test(a.name, a.notes) then 'test_row' end, a.name),
     (case when a.deleted_at is null and nullif(btrim(a.name), '') is null then 'missing_name' end, 'placeholder name written'),
     (case when a.deleted_at is not null then 'soft_deleted_in_v2' end, a.name || ' (deleted ' || a.deleted_at || '; kept in legacy only)')) f(flag, detail)
   where migration.in_scope(a.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- Additional reps on an account (V2 account_assignments beyond the first).
  insert into public.account_assignment(tenant_id, account_id, user_id, role)
  select v_t, x.id, migration.uid(aa.user_id::text), 'support'
    from legacy.account_assignments aa
    join public.account x on x.tenant_id = v_t and x.legacy_table = 'accounts' and x.legacy_id = aa.account_id::text
   where migration.in_scope(aa.org_id) and migration.uid(aa.user_id::text) is not null
     and migration.uid(aa.user_id::text) is distinct from x.owner_user_id
  on conflict (account_id, user_id) do nothing;

  -- ============================================================================================ 3. contacts
  -- contact_employment rows are written by Dilly's contact trigger (source dillyv2 on insert).
  insert into public.contact as x (
    tenant_id, account_id, first_name, last_name, title, persona_role, email, phone,
    source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
  select v_t, acc.id, c.first_name, c.last_name, c.title,
         migration.map('decision_role', c.decision_role),
         nullif(btrim(c.email), ''), c.phone,
         'dillyv2', c.legacy_table, c.legacy_id,
         migration.looks_test(c.v2_full_name, c.email),
         migration.uid(c.created_by_legacy_user_id),
         c.created_at, c.updated_at
    from legacy_v.contacts c
    left join public.account acc on acc.tenant_id = v_t and acc.legacy_table = 'accounts' and acc.legacy_id = c.account_legacy_id
   where migration.in_scope(c.org_id) and c.deleted_at is null
   order by c.created_at, c.legacy_id
  on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
    account_id   = excluded.account_id,
    first_name   = excluded.first_name, last_name = excluded.last_name, title = excluded.title,
    persona_role = excluded.persona_role,
    email        = excluded.email, phone = excluded.phone,
    is_test      = excluded.is_test,
    created_by   = coalesce(excluded.created_by, x.created_by),
    created_at   = excluded.created_at;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'contact', x.id, c.legacy_table, c.legacy_id, f.field, f.value
    from legacy_v.contacts c
    join public.contact x on x.tenant_id = v_t and x.legacy_table = c.legacy_table and x.legacy_id = c.legacy_id
   cross join lateral (values
     ('v2_full_name', case when btrim(c.v2_full_name) is distinct from x.full_name then c.v2_full_name end),
     ('v2_decision_role', c.decision_role),
     ('v2_priority_score', nullif(c.priority_score, 0)::text),
     ('v2_is_active', case when not c.is_active then 'false' end)) f(field, value)
   where migration.in_scope(c.org_id) and f.value is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, c.legacy_table, c.legacy_id, f.flag, f.detail
    from legacy_v.contacts c
    left join public.account acc on acc.tenant_id = v_t and acc.legacy_table = 'accounts' and acc.legacy_id = c.account_legacy_id
   cross join lateral (values
     (case when c.deleted_at is null and migration.looks_test(c.v2_full_name, c.email) then 'test_row' end, c.v2_full_name),
     (case when c.deleted_at is null and c.account_legacy_id is not null and acc.id is null then 'orphan' end,
      'V2 account ' || c.account_legacy_id || ' missing or deleted; migrated without an account'),
     (case when c.deleted_at is null and not c.is_active then 'inactive_contact' end, 'inactive in V2 (left the company?)'),
     (case when c.deleted_at is not null then 'soft_deleted_in_v2' end, c.v2_full_name || ' (kept in legacy only)')) f(flag, detail)
   where migration.in_scope(c.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 4. properties
  -- property.account_id is NOT written here: it follows property_party (step 5), so history semantics hold.
  insert into public.property as x (
    tenant_id, name, address1, city, state, zip, asset_class, roof_system, roof_area_sf, roof_install_year, notes, external_ref,
    source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
  select v_t, p.name, p.address1, p.city, p.state, p.zip, p.asset_class, p.roof_system, p.roof_area_sf, p.roof_install_year,
         p.notes, p.external_ref,
         'dillyv2', p.legacy_table, p.legacy_id,
         migration.looks_test(p.name, p.address1, p.notes),
         migration.uid(p.created_by_legacy_user_id),
         p.created_at, p.updated_at
    from legacy_v.properties p
   where migration.in_scope(p.org_id) and p.deleted_at is null
   order by p.created_at, p.legacy_id
  on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
    name = excluded.name, address1 = excluded.address1, city = excluded.city, state = excluded.state, zip = excluded.zip,
    asset_class = excluded.asset_class, roof_system = excluded.roof_system, roof_area_sf = excluded.roof_area_sf,
    roof_install_year = excluded.roof_install_year, notes = excluded.notes, external_ref = excluded.external_ref,
    is_test    = excluded.is_test,
    created_by = coalesce(excluded.created_by, x.created_by),
    created_at = excluded.created_at;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'property', x.id, p.legacy_table, p.legacy_id, f.field, f.value
    from legacy_v.properties p
    join public.property x on x.tenant_id = v_t and x.legacy_table = p.legacy_table and x.legacy_id = p.legacy_id
   cross join lateral (values ('v2_sq_footage', p.roof_area_sf::text), ('v2_roof_age_years', p.roof_age_years::text),
                              ('v2_website', p.website), ('v2_country', nullif(p.country, 'US')),
                              ('v2_intel_property_id', p.intel_property_id::text),
                              ('v2_is_active', case when not p.is_active then 'false' end)) f(field, value)
   where migration.in_scope(p.org_id) and f.value is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, p.legacy_table, p.legacy_id, f.flag, f.detail
    from legacy_v.properties p
   cross join lateral (values
     (case when p.deleted_at is null and migration.looks_test(p.name, p.address1, p.notes) then 'test_row' end, concat_ws(' / ', p.name, p.address1)),
     (case when p.deleted_at is null and not p.is_active then 'inactive_property' end, 'inactive in V2'),
     (case when p.deleted_at is not null then 'soft_deleted_in_v2' end, concat_ws(' / ', p.name, p.address1) || ' (kept in legacy only)')) f(flag, detail)
   where migration.in_scope(p.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 5. ownership & management
  -- V2 property_accounts (owner / property_manager) and properties.primary_account_id -> property_party rows with
  -- source 'dillyv2'; Dilly's trigger then sets property.account_id (current manager, else current owner).
  -- A building whose management history someone changed IN DILLY (transfer, rep edit, agent) belongs to Dilly:
  -- V2 is ignored for it from then on. Re-runs end rows V2 ended or replaced (history is kept, never deleted).
  create temp table _app_owned on commit drop as
    select distinct pp.property_id from public.property_party pp join public.property p on p.id = pp.property_id
     where p.tenant_id = v_t and (pp.source in ('rep', 'transfer', 'agent') or (pp.source = 'direct_edit' and pp.created_by is not null));

  create temp table _party on commit drop as
    select d.legacy_key, p.id as property_id, a.id as account_id, d.role, d.started_on, d.ended_on
      from legacy_v.property_parties d
      join public.property p on p.tenant_id = v_t and p.legacy_table = 'properties' and p.legacy_id = d.property_legacy_id
      join public.account  a on a.tenant_id = v_t and a.legacy_table = 'accounts'   and a.legacy_id = d.account_legacy_id
     where migration.in_scope(d.org_id) and d.disposition = 'ok'
       and not exists (select 1 from _app_owned o where o.property_id = p.id);

  delete from migration.link l where l.tenant_id = v_t and l.target_table = 'property_party'
     and not exists (select 1 from public.property_party pp where pp.id = l.target_id);

  -- V2 link gone, or now pointing elsewhere: end the current row here (history stays).
  update public.property_party pp set ended_on = greatest(v_today, coalesce(pp.started_on, v_today))
    from migration.link l
   where l.tenant_id = v_t and l.target_table = 'property_party' and l.target_id = pp.id and pp.ended_on is null
     and not exists (select 1 from _app_owned o where o.property_id = pp.property_id)
     and not exists (select 1 from _party d where d.legacy_key = l.legacy_key and d.property_id = pp.property_id
                                              and d.account_id = pp.account_id and d.role = pp.role);
  delete from migration.link l using public.property_party pp
   where l.tenant_id = v_t and l.target_table = 'property_party' and l.target_id = pp.id
     and not exists (select 1 from _party d where d.legacy_key = l.legacy_key and d.property_id = pp.property_id
                                              and d.account_id = pp.account_id and d.role = pp.role)
     and not exists (select 1 from _app_owned o where o.property_id = pp.property_id);

  -- V2 ended a link that is still current here.
  update public.property_party pp set ended_on = greatest(d.ended_on, coalesce(pp.started_on, d.ended_on))
    from migration.link l join _party d on d.legacy_key = l.legacy_key
   where l.tenant_id = v_t and l.target_table = 'property_party' and l.target_id = pp.id
     and pp.ended_on is null and d.ended_on is not null;

  -- New rows (historical first, then current).
  for r in select d.* from _party d
            where not exists (select 1 from migration.link l where l.tenant_id = v_t and l.legacy_key = d.legacy_key and l.target_table = 'property_party')
            order by d.ended_on is null, d.started_on nulls first, d.legacy_key loop
    if r.ended_on is null then
      -- a machine-written current row for the same role (earlier link, backfill) makes way
      update public.property_party set ended_on = greatest(v_today, coalesce(started_on, v_today))
       where property_id = r.property_id and role = r.role and ended_on is null;
    end if;
    insert into public.property_party(tenant_id, property_id, account_id, role, started_on, ended_on, source, note)
    values (v_t, r.property_id, r.account_id, r.role, r.started_on, r.ended_on, 'dillyv2', 'Dilly V2 ' || split_part(r.legacy_key, ':', 1))
    returning id into v_id;
    insert into migration.link(tenant_id, legacy_key, target_table, target_id) values (v_t, r.legacy_key, 'property_party', v_id);
  end loop;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'property', p.id, d.legacy_table, d.legacy_id, 'related_account', d.relationship_type || ':' || d.account_legacy_id
    from legacy_v.property_parties d
    join public.property p on p.tenant_id = v_t and p.legacy_table = 'properties' and p.legacy_id = d.property_legacy_id
   where migration.in_scope(d.org_id) and d.disposition = 'not_a_party'
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, d.legacy_table, d.legacy_id, f.flag, f.detail
    from legacy_v.property_parties d
    left join public.property p on p.tenant_id = v_t and p.legacy_table = 'properties' and p.legacy_id = d.property_legacy_id
    left join public.account  a on a.tenant_id = v_t and a.legacy_table = 'accounts'   and a.legacy_id = d.account_legacy_id
   cross join lateral (values
     (case when d.disposition in ('extra_current', 'primary_unplaced') then d.disposition end,
      'property ' || d.property_legacy_id || ' already has a current ' || coalesce(d.role, 'owner and manager') || '; link kept in legacy only'),
     (case when d.disposition = 'ok' and (p.id is null or a.id is null) then 'orphan_link' end,
      case when p.id is null then 'property ' || d.property_legacy_id else 'account ' || d.account_legacy_id end || ' missing or deleted')) f(flag, detail)
   where migration.in_scope(d.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 6. property contacts
  insert into public.property_contact as x (tenant_id, property_id, contact_id, role)
  select v_t, p.id, c.id, string_agg(distinct pc.role, ', ' order by pc.role)
    from legacy_v.property_contacts pc
    join public.property p on p.tenant_id = v_t and p.legacy_table = 'properties' and p.legacy_id = pc.property_legacy_id
    join public.contact  c on c.tenant_id = v_t and c.legacy_table = 'contacts'   and c.legacy_id = pc.contact_legacy_id
   where migration.in_scope(pc.org_id) and pc.active
   group by p.id, c.id
  on conflict (property_id, contact_id) do update set role = excluded.role;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, pc.legacy_table, pc.legacy_id, f.flag, f.detail
    from legacy_v.property_contacts pc
    left join public.property p on p.tenant_id = v_t and p.legacy_table = 'properties' and p.legacy_id = pc.property_legacy_id
    left join public.contact  c on c.tenant_id = v_t and c.legacy_table = 'contacts'   and c.legacy_id = pc.contact_legacy_id
   cross join lateral (values
     (case when pc.active and (p.id is null or c.id is null) then 'orphan_link' end,
      case when p.id is null then 'property ' || pc.property_legacy_id else 'contact ' || pc.contact_legacy_id end || ' missing or deleted'),
     (case when not pc.active then 'inactive_link' end, 'inactive in V2; not linked')) f(flag, detail)
   where migration.in_scope(pc.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 7. property assignments
  -- V2 property_assignments -> active property_pursuit for that rep (once; ending it in Dilly is respected).
  for r in select x.id, p.id as property_id, migration.uid(x.user_id::text) as user_id, x.created_at
             from legacy.property_assignments x
             join public.property p on p.tenant_id = v_t and p.legacy_table = 'properties' and p.legacy_id = x.property_id::text
            where migration.in_scope(x.org_id) and migration.uid(x.user_id::text) is not null
              and not exists (select 1 from migration.link l where l.tenant_id = v_t and l.legacy_key = 'property_assignments:' || x.id
                                                              and l.target_table = 'property_pursuit') loop
    v_id := null;
    insert into public.property_pursuit(tenant_id, property_id, user_id, status, started_at, note)
    values (v_t, r.property_id, r.user_id, 'active', r.created_at, 'Assigned in Dilly V2')
    on conflict do nothing returning id into v_id;
    if v_id is null then
      select id into v_id from public.property_pursuit where property_id = r.property_id and user_id = r.user_id and status = 'active';
    end if;
    insert into migration.link(tenant_id, legacy_key, target_table, target_id) values (v_t, 'property_assignments:' || r.id, 'property_pursuit', v_id);
  end loop;

  insert into migration.unmapped_actor as a (tenant_id, legacy_table, legacy_id, role_column, legacy_user_id, legacy_email)
  select v_t, 'property_assignments', x.id::text, 'assignee', x.user_id::text, m.email
    from legacy.property_assignments x
    left join migration.user_map m on m.tenant_id = v_t and m.legacy_user_id = x.user_id::text
   where migration.in_scope(x.org_id) and m.profile_id is null
  on conflict (tenant_id, legacy_table, legacy_id, role_column) do update set legacy_email = excluded.legacy_email;

  -- ============================================================================================ 8. opportunities
  insert into public.opportunity as x (
    tenant_id, account_id, property_id, primary_contact_id, name, service_line, stage, value_estimate, owner_user_id,
    stage_changed_at, won_at, lost_at, lost_reason, source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
  select v_t,
         coalesce(acc.id, prop.account_id),
         prop.id,
         con.id,
         coalesce(nullif(btrim(o.name), ''),
                  concat_ws(' — ', coalesce(prop.name, prop.address1, acc.name), initcap(replace(o.svc, '_', ' '))),
                  'Dilly V2 opportunity ' || o.legacy_id),
         o.svc, o.stg, o.value,
         coalesce(migration.uid(o.owner_legacy_user_id), migration.uid(o.created_by_legacy_user_id)),
         coalesce(o.closed_at, o.updated_at, o.created_at),
         case when o.stg = 'won'  then coalesce(o.closed_at, o.updated_at) end,
         case when o.stg = 'lost' then coalesce(o.closed_at, o.updated_at) end,
         case when o.stg = 'lost' then nullif(concat_ws(': ', o.lost_reason_name, nullif(btrim(o.lost_notes), '')), '') end,
         'dillyv2', o.legacy_table, o.legacy_id,
         migration.looks_test(o.name, o.lost_notes),
         migration.uid(o.created_by_legacy_user_id),
         o.created_at, o.updated_at
    from (select v.*, migration.map('scope_type', v.scope_name, v.scope_key) as svc,
                 migration.opp_stage(v.status, v.stage_name, v.stage_key) as stg
            from legacy_v.opportunities v where migration.in_scope(v.org_id) and v.deleted_at is null) o
    left join public.account  acc  on acc.tenant_id  = v_t and acc.legacy_table  = 'accounts'   and acc.legacy_id  = o.account_legacy_id
    left join public.property prop on prop.tenant_id = v_t and prop.legacy_table = 'properties' and prop.legacy_id = o.property_legacy_id
    left join public.contact  con  on con.tenant_id  = v_t and con.legacy_table  = 'contacts'   and con.legacy_id  = o.contact_legacy_id
   order by o.created_at, o.legacy_id
  on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
    account_id         = excluded.account_id,
    property_id        = excluded.property_id,
    primary_contact_id = excluded.primary_contact_id,
    name               = excluded.name,
    service_line       = excluded.service_line,
    stage              = excluded.stage,
    value_estimate     = excluded.value_estimate,
    owner_user_id      = coalesce(excluded.owner_user_id, x.owner_user_id),
    won_at             = coalesce(x.won_at, excluded.won_at),
    lost_at            = coalesce(x.lost_at, excluded.lost_at),
    lost_reason        = coalesce(excluded.lost_reason, x.lost_reason),
    is_test            = excluded.is_test,
    created_by         = coalesce(excluded.created_by, x.created_by),
    created_at         = excluded.created_at;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'opportunity', x.id, o.legacy_table, o.legacy_id, f.field, f.value
    from legacy_v.opportunities o
    join public.opportunity x on x.tenant_id = v_t and x.legacy_table = o.legacy_table and x.legacy_id = o.legacy_id
   cross join lateral (values ('v2_stage', o.stage_name), ('v2_status', o.status), ('v2_scope', o.scope_name),
                              ('v2_estimated_value', o.estimated_value::text), ('v2_bid_value', o.bid_value::text),
                              ('v2_final_value', o.final_value::text), ('v2_created_reason', o.created_reason),
                              ('v2_lost_notes', o.lost_notes), ('v2_opened_at', o.opened_at::text),
                              ('v2_created_from_touchpoint_id', o.created_from_touchpoint_legacy_id)) f(field, value)
   where migration.in_scope(o.org_id) and f.value is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, o.legacy_table, o.legacy_id, f.flag, f.detail
    from legacy_v.opportunities o
    left join public.property prop on prop.tenant_id = v_t and prop.legacy_table = 'properties' and prop.legacy_id = o.property_legacy_id
   cross join lateral (values
     (case when o.deleted_at is null and migration.looks_test(o.name, o.lost_notes) then 'test_row' end, o.name),
     (case when o.deleted_at is null and nullif(btrim(o.name), '') is null then 'missing_name' end, 'name generated from property/account'),
     (case when o.deleted_at is null and prop.id is null then 'orphan' end, 'property ' || o.property_legacy_id || ' missing or deleted'),
     (case when o.deleted_at is not null then 'soft_deleted_in_v2' end, coalesce(o.name, o.legacy_id) || ' (kept in legacy only)')) f(flag, detail)
   where migration.in_scope(o.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 9. touches
  -- Append-only ledger: inserted once in time order (is_first_touch right); a re-run only refreshes notes.
  -- Gmail-linked touches carry external_id 'gmail:<message id>' so Dilly's own Gmail sync never logs them twice
  -- (first touch per message id; later duplicates are flagged and keep the id in legacy_value).
  insert into public.touch as x (
    tenant_id, occurred_at, user_id, account_id, contact_id, property_id, opportunity_id,
    channel, direction, outcome, notes, source, external_id, legacy_table, legacy_id, created_at)
  select v_t, t.occurred_at,
         migration.uid(t.actor_legacy_user_id),
         acc.id, con.id, prop.id, opp.id,
         migration.map('touch_type', t.type_name, t.type_key),
         migration.map('touch_direction', t.direction),
         migration.map('touch_outcome', t.outcome_name, t.outcome_key),
         t.notes,
         'dillyv2',
         case when t.gmail_message_id is not null and t.gmail_rn = 1
               and not exists (select 1 from public.touch e where e.tenant_id = v_t and e.source = 'dillyv2'
                                  and e.external_id = 'gmail:' || t.gmail_message_id)
              then 'gmail:' || t.gmail_message_id end,
         t.legacy_table, t.legacy_id,
         coalesce(t.created_at, t.occurred_at)
    from (select v.*, row_number() over (partition by v.gmail_message_id order by v.occurred_at, v.legacy_table desc, v.legacy_id) as gmail_rn
            from legacy_v.touches v where migration.in_scope(v.org_id)) t
    left join public.account     acc  on acc.tenant_id  = v_t and acc.legacy_table  = 'accounts'      and acc.legacy_id  = t.account_legacy_id
    left join public.contact     con  on con.tenant_id  = v_t and con.legacy_table  = 'contacts'      and con.legacy_id  = t.contact_legacy_id
    left join public.property    prop on prop.tenant_id = v_t and prop.legacy_table = 'properties'    and prop.legacy_id = t.property_legacy_id
    left join public.opportunity opp  on opp.tenant_id  = v_t and opp.legacy_table  = 'opportunities' and opp.legacy_id  = t.opportunity_legacy_id
   order by t.occurred_at, t.legacy_id
  on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
    notes = excluded.notes;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'touch', x.id, t.legacy_table, t.legacy_id, f.field, f.value
    from legacy_v.touches t
    join public.touch x on x.tenant_id = v_t and x.legacy_table = t.legacy_table and x.legacy_id = t.legacy_id
   cross join lateral (values
     ('provenance', case when t.legacy_table = 'synced_emails' then 'gmail_unlogged' when t.gmail_message_id is not null then 'gmail' else 'rep' end),
     ('gmail_message_id', t.gmail_message_id), ('gmail_thread_id', t.gmail_thread_id), ('email_subject', t.email_subject),
     ('v2_type', t.type_name), ('v2_outcome', t.outcome_name), ('v2_engagement_phase', t.engagement_phase)) f(field, value)
   where migration.in_scope(t.org_id) and f.value is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, t.legacy_table, t.legacy_id, f.flag, f.detail
    from legacy_v.touches t
    join public.touch x on x.tenant_id = v_t and x.legacy_table = t.legacy_table and x.legacy_id = t.legacy_id
   cross join lateral (values
     (case when t.gmail_message_id is not null and x.external_id is null then 'duplicate_gmail_message' end,
      'Gmail message ' || t.gmail_message_id || ' is on more than one V2 touch; id kept in migration.legacy_value'),
     (case when t.contact_legacy_id is not null and x.contact_id is null then 'orphan' end, 'contact ' || t.contact_legacy_id || ' missing or deleted'),
     (case when t.property_legacy_id is not null and x.property_id is null then 'orphan_property' end, 'property ' || t.property_legacy_id || ' missing or deleted'),
     (case when migration.looks_test(t.notes) then 'test_note' end, left(t.notes, 200))) f(flag, detail)
   where migration.in_scope(t.org_id) and f.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 10. follow-ups
  -- V2 next_actions -> task (kind follow_up) with the ORIGINAL created_at and due date; app.reconcile_tasks below
  -- closes every one that already has a later touch on the same contact (account when no contact).
  -- A follow-up created by a touch carries that touch's exact timestamp in V2; it is stamped 1 ms after its own
  -- touch so the touch that created it does not also close it (original kept in legacy_value v2_created_at).
  -- A re-run never re-opens a task Dilly already closed.
  insert into public.task as k (
    tenant_id, assignee_user_id, account_id, contact_id, property_id, opportunity_id, kind, title, reason, due_on, status,
    snooze_count, completed_at, completed_by_touch_id, created_from_touch_id, source, legacy_table, legacy_id, created_by, created_at, updated_at)
  select v_t,
         migration.uid(f.assignee_legacy_user_id),
         coalesce(acc.id, con.account_id),
         con.id, prop.id, opp.id,
         'follow_up',
         case when f.type_name is not null
              then 'Follow up (' || lower(f.type_name) || ') with ' || coalesce(con.full_name, f.contact_name, 'contact')
              else 'Follow up with ' || coalesce(con.full_name, f.contact_name, 'contact') end,
         coalesce(nullif(btrim(f.notes), ''), 'Dilly V2 follow-up'),
         coalesce(f.due_on, f.created_at::date),
         f.st,
         least(coalesce(f.snoozed_count, 0), 32767)::smallint,
         case when f.st = 'done' then coalesce(done_t.occurred_at, f.updated_at) end,
         case when f.st = 'done' then done_t.id end,
         from_t.id,
         'dillyv2', f.legacy_table, f.legacy_id,
         migration.uid(f.created_by_legacy_user_id),
         case when from_t.occurred_at >= f.created_at then from_t.occurred_at + interval '1 millisecond' else f.created_at end,
         f.updated_at
    from (select v.*, migration.map('task_status', v.status) as st from legacy_v.follow_ups v where migration.in_scope(v.org_id)) f
    left join public.account  acc  on acc.tenant_id  = v_t and acc.legacy_table  = 'accounts'      and acc.legacy_id  = f.account_legacy_id
    left join public.contact  con  on con.tenant_id  = v_t and con.legacy_table  = 'contacts'      and con.legacy_id  = f.contact_legacy_id
    left join public.property prop on prop.tenant_id = v_t and prop.legacy_table = 'properties'    and prop.legacy_id = f.property_legacy_id
    left join public.opportunity opp on opp.tenant_id = v_t and opp.legacy_table = 'opportunities' and opp.legacy_id = f.opportunity_legacy_id
    left join public.touch from_t on from_t.tenant_id = v_t and from_t.legacy_table = 'touchpoints' and from_t.legacy_id = f.created_from_touchpoint_legacy_id
    left join public.touch done_t on done_t.tenant_id = v_t and done_t.legacy_table = 'touchpoints' and done_t.legacy_id = f.completed_by_touchpoint_legacy_id
   order by f.created_at, f.legacy_id
  on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
    assignee_user_id = coalesce(excluded.assignee_user_id, k.assignee_user_id),
    account_id       = excluded.account_id,
    contact_id       = excluded.contact_id,
    property_id      = excluded.property_id,
    opportunity_id   = excluded.opportunity_id,
    title            = excluded.title,
    reason           = excluded.reason,
    due_on           = excluded.due_on,
    status           = case when k.status = 'open' then excluded.status else k.status end,
    completed_at     = case when k.status = 'open' then excluded.completed_at else k.completed_at end,
    completed_by_touch_id = case when k.status = 'open' then excluded.completed_by_touch_id else k.completed_by_touch_id end,
    snooze_count     = excluded.snooze_count,
    created_from_touch_id = excluded.created_from_touch_id,
    created_at       = excluded.created_at;

  insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
  select v_t, 'task', k.id, f.legacy_table, f.legacy_id, x.field, x.value
    from legacy_v.follow_ups f
    join public.task k on k.tenant_id = v_t and k.legacy_table = f.legacy_table and k.legacy_id = f.legacy_id
   cross join lateral (values ('v2_status', f.status), ('v2_due_at', f.due_at::text), ('v2_dismiss_reason', f.dismiss_reason),
                              ('v2_created_at', case when k.created_at <> f.created_at then f.created_at::text end)) x(field, value)
   where migration.in_scope(f.org_id) and x.value is not null
  on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

  insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
  select v_t, f.legacy_table, f.legacy_id, x.flag, x.detail
    from legacy_v.follow_ups f
    left join public.contact con on con.tenant_id = v_t and con.legacy_table = 'contacts' and con.legacy_id = f.contact_legacy_id
   cross join lateral (values
     (case when migration.looks_test(f.notes) then 'test_row' end, f.notes),
     (case when f.contact_legacy_id is not null and con.id is null then 'orphan' end, 'contact ' || f.contact_legacy_id || ' missing or deleted')) x(flag, detail)
   where migration.in_scope(f.org_id) and x.flag is not null
  on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

  -- ============================================================================================ 11. preferences
  -- V2 account status -> account_preference. A preference someone set in Dilly (set_by not null) is never overwritten.
  insert into public.account_preference as p (tenant_id, account_id, preference, reason, set_by, set_at)
  select v_t, x.id, m.pref, 'Dilly V2 status: ' || m.status, null, m.updated_at
    from (select v.legacy_table, v.legacy_id, v.status, v.updated_at, migration.map('account_status', v.status) as pref
            from legacy_v.accounts v where migration.in_scope(v.org_id) and v.deleted_at is null) m
    join public.account x on x.tenant_id = v_t and x.legacy_table = m.legacy_table and x.legacy_id = m.legacy_id
   where m.pref is not null
  on conflict (tenant_id, account_id) do update
     set preference = excluded.preference, reason = excluded.reason, set_at = excluded.set_at
   where p.set_by is null and p.reason like 'Dilly V2 status:%';

  -- ============================================================================================ 12. people not signed in yet
  perform migration.note_actors('accounts', 'owner_legacy_user_id', 'owner', 'v.deleted_at is null');
  perform migration.note_actors('accounts', 'created_by_legacy_user_id', 'created_by', 'v.deleted_at is null');
  perform migration.note_actors('contacts', 'created_by_legacy_user_id', 'created_by', 'v.deleted_at is null');
  perform migration.note_actors('properties', 'created_by_legacy_user_id', 'created_by', 'v.deleted_at is null');
  perform migration.note_actors('opportunities', 'owner_legacy_user_id', 'owner', 'v.deleted_at is null');
  perform migration.note_actors('touches', 'actor_legacy_user_id', 'actor');
  perform migration.note_actors('follow_ups', 'assignee_legacy_user_id', 'assignee');
  update migration.unmapped_actor a set resolved_profile_id = m.profile_id
    from migration.user_map m
   where a.tenant_id = v_t and m.tenant_id = v_t and a.legacy_user_id = m.legacy_user_id
     and m.profile_id is not null and a.resolved_profile_id is distinct from m.profile_id;

  -- Touches of reps who signed in after an earlier run: fill touch.user_id. The ledger guard is lifted for this one
  -- statement only, only for dillyv2 touches with no user whose V2 rep is now known. No points are awarded.
  if exists (select 1 from migration.unmapped_actor a
               join public.touch x on x.tenant_id = a.tenant_id and x.legacy_table = a.legacy_table and x.legacy_id = a.legacy_id
              where a.tenant_id = v_t and a.role_column = 'actor' and a.resolved_profile_id is not null
                and x.source = 'dillyv2' and x.user_id is null) then
    alter table public.touch disable trigger touch_guard;
    update public.touch x set user_id = a.resolved_profile_id
      from migration.unmapped_actor a
     where a.tenant_id = v_t and a.role_column = 'actor' and a.resolved_profile_id is not null
       and x.tenant_id = a.tenant_id and x.legacy_table = a.legacy_table and x.legacy_id = a.legacy_id
       and x.source = 'dillyv2' and x.user_id is null;
    get diagnostics v_n = row_count;
    alter table public.touch enable trigger touch_guard;
    raise notice 're-attributed % touches to reps who signed in', v_n;
  end if;
  update public.task k set assignee_user_id = a.resolved_profile_id
    from migration.unmapped_actor a
   where a.tenant_id = v_t and a.role_column = 'assignee' and a.resolved_profile_id is not null
     and k.tenant_id = v_t and k.legacy_table = a.legacy_table and k.legacy_id = a.legacy_id and k.assignee_user_id is null;

  -- ============================================================================================ 13. close + suggest
  insert into migration.run_log(step, detail)
  select 'reconcile_tasks', jsonb_build_object('tasks_closed', app.reconcile_tasks(v_t));

  -- Duplicate SUGGESTIONS only. Nothing is merged; public.*.duplicate_of is not touched.
  delete from migration.duplicate_suggestion where tenant_id = v_t;
  with c as (
    select id, account_id, created_at, lower(full_name) as nm, lower(email::text) as em,
           nullif(regexp_replace(coalesce(phone, mobile, ''), '\D', '', 'g'), '') as ph
      from public.contact where tenant_id = v_t and source = 'dillyv2'
  ), pairs as (
    select b.id as record_id, a.id as duplicate_of,
           concat_ws(', ',
             case when a.account_id = b.account_id and a.nm = b.nm then 'same name on same account' end,
             case when a.em = b.em then 'same email' end,
             case when a.ph = b.ph and length(a.ph) >= 10 then 'same phone' end) as reason,
           a.created_at as dup_created
      from c a join c b on (a.created_at, a.id) < (b.created_at, b.id)
     where (a.account_id = b.account_id and a.nm = b.nm) or a.em = b.em or (a.ph = b.ph and length(a.ph) >= 10)
  )
  insert into migration.duplicate_suggestion(tenant_id, entity, record_id, duplicate_of, reason)
  select distinct on (record_id) v_t, 'contact', record_id, duplicate_of, reason
    from pairs order by record_id, dup_created, duplicate_of
  on conflict do nothing;

  with a as (select id, created_at, normalized_name from public.account
              where tenant_id = v_t and source = 'dillyv2' and normalized_name is not null)
  insert into migration.duplicate_suggestion(tenant_id, entity, record_id, duplicate_of, reason)
  select distinct on (y.id) v_t, 'account', y.id, x.id, 'same normalized name'
    from a x join a y on x.normalized_name = y.normalized_name and (x.created_at, x.id) < (y.created_at, y.id)
   order by y.id, x.created_at, x.id
  on conflict do nothing;

  with p as (select id, created_at, normalized_address from public.property
              where tenant_id = v_t and source = 'dillyv2' and normalized_address is not null)
  insert into migration.duplicate_suggestion(tenant_id, entity, record_id, duplicate_of, reason)
  select distinct on (y.id) v_t, 'property', y.id, x.id, 'same normalized address'
    from p x join p y on x.normalized_address = y.normalized_address and (x.created_at, x.id) < (y.created_at, y.id)
   order by y.id, x.created_at, x.id
  on conflict do nothing;

  insert into migration.run_log(step, detail)
  select 'transform', jsonb_build_object(
    'accounts',      (select count(*) from public.account     where tenant_id = v_t and source = 'dillyv2'),
    'contacts',      (select count(*) from public.contact     where tenant_id = v_t and source = 'dillyv2'),
    'properties',    (select count(*) from public.property    where tenant_id = v_t and source = 'dillyv2'),
    'opportunities', (select count(*) from public.opportunity where tenant_id = v_t and source = 'dillyv2'),
    'touches',       (select count(*) from public.touch       where tenant_id = v_t and source = 'dillyv2'),
    'tasks',         (select count(*) from public.task        where tenant_id = v_t and source = 'dillyv2'),
    'open_tasks',    (select count(*) from public.task        where tenant_id = v_t and source = 'dillyv2' and status = 'open'),
    'unmapped_actors', (select count(*) from migration.unmapped_actor where tenant_id = v_t and resolved_profile_id is null));
  raise notice 'transform committed';
end $transform$;

-- Result: what is in Dilly now (FOX tenant, migrated rows).
with t as (select migration.tenant_id() as id)
select 'accounts' as entity, (select count(*) from public.account a, t where a.tenant_id = t.id and a.source = 'dillyv2')::text as rows
union all select 'contacts', (select count(*) from public.contact c, t where c.tenant_id = t.id and c.source = 'dillyv2')::text
union all select 'properties', (select count(*) from public.property p, t where p.tenant_id = t.id and p.source = 'dillyv2')::text
union all select 'ownership/management rows (property_party)', (select count(*) from public.property_party pp, t where pp.tenant_id = t.id and pp.source = 'dillyv2')::text
union all select 'property contacts', (select count(*) from public.property_contact pc join public.property p on p.id = pc.property_id, t where pc.tenant_id = t.id and p.source = 'dillyv2')::text
union all select 'opportunities', (select count(*) from public.opportunity o, t where o.tenant_id = t.id and o.source = 'dillyv2')::text
union all select 'touches', (select count(*) from public.touch x, t where x.tenant_id = t.id and x.source = 'dillyv2')::text
union all select 'follow-ups (tasks)', (select count(*) from public.task k, t where k.tenant_id = t.id and k.source = 'dillyv2')::text
union all select 'follow-ups still open', (select count(*) from public.task k, t where k.tenant_id = t.id and k.source = 'dillyv2' and k.status = 'open')::text
union all select 'people: signed in / invited', (select count(*) filter (where profile_id is not null) || ' / ' || count(*) filter (where profile_id is null) from migration.user_map m, t where m.tenant_id = t.id)
union all select 'rows flagged for review', (select count(*) from migration.flagged_row f, t where f.tenant_id = t.id)::text
union all select 'next step', 'run 04-reconcile.sql';
