-- 30_properties.sql — legacy_v.properties -> public.property. Idempotent.
-- Unlinked or orphaned properties migrate with account_id null (orphans flagged). Duplicate addresses are suggested, not merged.
-- Re-runs (06-delta) must not undo management changes recorded in the new app: once a property has ownership history
-- that a person or agent wrote in Dilly (a transfer, a rep edit, an agent) the app owns property.account_id and V2's
-- value is ignored. Backfill / insert / import / dillyv2 rows and direct edits without a user (earlier migration runs)
-- don't count.

insert into public.property as t (
  tenant_id, account_id, name, address1, city, state, zip, asset_class, roof_system, roof_area_sf, building_count, notes,
  source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
select migration.tenant_id(),
       acc.id,
       p.name, p.address1, p.city, p.state, p.zip, p.asset_class, p.roof_system, p.roof_area_sf, p.building_count, p.notes,
       'dillyv2', p.legacy_table, p.legacy_id,
       migration.looks_test(p.name, p.address1, p.notes),
       migration.uid(p.created_by_legacy_user_id),
       coalesce(p.created_at, now()), coalesce(p.updated_at, p.created_at, now())
  from legacy_v.properties p
  left join public.account acc on acc.tenant_id = migration.tenant_id()
        and acc.legacy_table = migration.lt('accounts') and acc.legacy_id = p.account_legacy_id
 where migration.in_scope(p.org_id)
 order by p.created_at nulls last, p.legacy_id
on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
  account_id = case when exists (
                   select 1 from public.property_party pp
                    where pp.property_id = t.id
                      and (pp.source in ('rep','transfer','agent') or (pp.source = 'direct_edit' and pp.created_by is not null)))
                 then t.account_id else excluded.account_id end,
  name = excluded.name, address1 = excluded.address1, city = excluded.city, state = excluded.state, zip = excluded.zip,
  asset_class = excluded.asset_class, roof_system = excluded.roof_system, roof_area_sf = excluded.roof_area_sf,
  building_count = excluded.building_count, notes = excluded.notes,
  is_test    = excluded.is_test,
  created_by = coalesce(excluded.created_by, t.created_by),
  created_at = excluded.created_at;

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), p.legacy_table, p.legacy_id, f.flag, f.detail
  from legacy_v.properties p
  left join public.account acc on acc.tenant_id = migration.tenant_id()
        and acc.legacy_table = migration.lt('accounts') and acc.legacy_id = p.account_legacy_id
  cross join lateral (values
    (case when migration.looks_test(p.name, p.address1, p.notes) then 'test_row' end, concat_ws(' / ', p.name, p.address1)),
    (case when p.account_legacy_id is not null and acc.id is null then 'orphan' end,
     'V2 account ' || p.account_legacy_id || ' does not exist; migrated unlinked')) f(flag, detail)
 where migration.in_scope(p.org_id) and f.flag is not null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

select migration.note_actors('properties', 'created_by_legacy_user_id', 'created_by');
