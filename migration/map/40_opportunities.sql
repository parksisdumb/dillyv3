-- 40_opportunities.sql — legacy_v.opportunities -> public.opportunity. Idempotent.
-- No points are awarded (opportunity trigger skips source dillyv2). next_step stays empty: V2 had none, and the
-- Sales Coach stall rules raise them in the new app. V2 notes have no column on opportunity: kept in migration.legacy_value.

insert into public.opportunity as t (
  tenant_id, account_id, property_id, primary_contact_id, name, service_line, stage, value_estimate,
  owner_user_id, stage_changed_at, won_at, lost_at, source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
select migration.tenant_id(),
       coalesce(acc.id, prop.account_id),
       prop.id,
       con.id,
       coalesce(nullif(btrim(o.name), ''),
                concat_ws(' — ', coalesce(prop.name, acc.name), initcap(replace(migration.map('opp_type', o.opp_type), '_', ' '))),
                'Dilly V2 opportunity ' || o.legacy_id),
       migration.map('opp_type', o.opp_type),
       migration.map('opp_stage', o.stage),
       o.value,
       migration.uid(o.owner_legacy_user_id),
       coalesce(o.stage_changed_at, o.updated_at, o.created_at, now()),
       case when migration.map('opp_stage', o.stage) = 'won'  then coalesce(o.stage_changed_at, o.updated_at) end,
       case when migration.map('opp_stage', o.stage) = 'lost' then coalesce(o.stage_changed_at, o.updated_at) end,
       'dillyv2', o.legacy_table, o.legacy_id,
       migration.looks_test(o.name, o.notes),
       migration.uid(o.created_by_legacy_user_id),
       coalesce(o.created_at, now()), coalesce(o.updated_at, o.created_at, now())
  from legacy_v.opportunities o
  left join public.account  acc  on acc.tenant_id  = migration.tenant_id() and acc.legacy_table  = migration.lt('accounts')   and acc.legacy_id  = o.account_legacy_id
  left join public.property prop on prop.tenant_id = migration.tenant_id() and prop.legacy_table = migration.lt('properties') and prop.legacy_id = o.property_legacy_id
  left join public.contact  con  on con.tenant_id  = migration.tenant_id() and con.legacy_table  = migration.lt('contacts')   and con.legacy_id  = o.contact_legacy_id
 where migration.in_scope(o.org_id)
 order by o.created_at nulls last, o.legacy_id
on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
  account_id         = excluded.account_id,
  property_id        = excluded.property_id,
  primary_contact_id = excluded.primary_contact_id,
  name               = excluded.name,
  service_line       = excluded.service_line,
  stage              = excluded.stage,
  value_estimate     = excluded.value_estimate,
  owner_user_id      = coalesce(excluded.owner_user_id, t.owner_user_id),
  won_at             = coalesce(t.won_at, excluded.won_at),
  lost_at            = coalesce(t.lost_at, excluded.lost_at),
  is_test            = excluded.is_test,
  created_by         = coalesce(excluded.created_by, t.created_by),
  created_at         = excluded.created_at;

insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
select migration.tenant_id(), 'opportunity', t.id, o.legacy_table, o.legacy_id, f.field, f.value
  from legacy_v.opportunities o
  join public.opportunity t on t.tenant_id = migration.tenant_id() and t.legacy_table = o.legacy_table and t.legacy_id = o.legacy_id
  cross join lateral (values ('notes', o.notes), ('legacy_stage', o.stage), ('legacy_type', o.opp_type)) f(field, value)
 where migration.in_scope(o.org_id) and f.value is not null
on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), o.legacy_table, o.legacy_id, f.flag, f.detail
  from legacy_v.opportunities o
  left join public.account  acc  on acc.tenant_id  = migration.tenant_id() and acc.legacy_table  = migration.lt('accounts')   and acc.legacy_id  = o.account_legacy_id
  left join public.property prop on prop.tenant_id = migration.tenant_id() and prop.legacy_table = migration.lt('properties') and prop.legacy_id = o.property_legacy_id
  cross join lateral (values
    (case when migration.looks_test(o.name, o.notes) then 'test_row' end, o.name),
    (case when nullif(btrim(o.name), '') is null then 'missing_name' end, 'name generated from property/account'),
    (case when (o.account_legacy_id is not null and acc.id is null) or (o.property_legacy_id is not null and prop.id is null)
          then 'orphan' end, 'account ' || coalesce(o.account_legacy_id, '-') || ' / property ' || coalesce(o.property_legacy_id, '-'))) f(flag, detail)
 where migration.in_scope(o.org_id) and f.flag is not null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

select migration.note_actors('opportunities', 'owner_legacy_user_id', 'owner');
select migration.note_actors('opportunities', 'created_by_legacy_user_id', 'created_by');
