-- 35_property_contacts.sql — legacy_v.property_contacts -> public.property_contact. Idempotent (PK property_id, contact_id).
-- public.property_contact has no legacy columns; traceability is through the property and contact legacy ids.
-- Links whose property or contact did not migrate are flagged 'orphan_link' (and counted by reconcile), never silently skipped.

insert into public.property_contact as t (tenant_id, property_id, contact_id, role)
select migration.tenant_id(), p.id, c.id, pc.role
  from legacy_v.property_contacts_in_scope pc
  join public.property p on p.tenant_id = migration.tenant_id() and p.legacy_table = migration.lt('properties') and p.legacy_id = pc.property_legacy_id
  join public.contact  c on c.tenant_id = migration.tenant_id() and c.legacy_table = migration.lt('contacts')  and c.legacy_id = pc.contact_legacy_id
on conflict (property_id, contact_id) do update set role = coalesce(excluded.role, t.role);

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), pc.legacy_table, pc.legacy_id, 'orphan_link',
       case when p.id is null then 'property ' || pc.property_legacy_id || ' missing' else 'contact ' || pc.contact_legacy_id || ' missing' end
  from legacy_v.property_contacts_in_scope pc
  left join public.property p on p.tenant_id = migration.tenant_id() and p.legacy_table = migration.lt('properties') and p.legacy_id = pc.property_legacy_id
  left join public.contact  c on c.tenant_id = migration.tenant_id() and c.legacy_table = migration.lt('contacts')  and c.legacy_id = pc.contact_legacy_id
 where p.id is null or c.id is null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;
