-- 20_contacts.sql — legacy_v.contacts -> public.contact. Idempotent.
-- Orphans (V2 account_id pointing at a missing account) migrate unlinked (account_id null) and are flagged.
-- Duplicates are NOT merged (see 90_post duplicate suggestions).

insert into public.contact as t (
  tenant_id, account_id, first_name, last_name, title, email, phone, mobile, notes,
  source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
select migration.tenant_id(),
       acc.id,
       c.first_name, c.last_name, c.title,
       nullif(btrim(c.email), '')::citext, c.phone, c.mobile, c.notes,
       'dillyv2', c.legacy_table, c.legacy_id,
       migration.looks_test(c.first_name, c.last_name, c.notes, c.email),
       migration.uid(c.created_by_legacy_user_id),
       coalesce(c.created_at, now()), coalesce(c.updated_at, c.created_at, now())
  from legacy_v.contacts c
  left join public.account acc on acc.tenant_id = migration.tenant_id()
        and acc.legacy_table = migration.lt('accounts') and acc.legacy_id = c.account_legacy_id
 where migration.in_scope(c.org_id)
 order by c.created_at nulls last, c.legacy_id
on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
  account_id = excluded.account_id,
  first_name = excluded.first_name, last_name = excluded.last_name, title = excluded.title,
  email      = excluded.email, phone = excluded.phone, mobile = excluded.mobile, notes = excluded.notes,
  is_test    = excluded.is_test,
  created_by = coalesce(excluded.created_by, t.created_by),
  created_at = excluded.created_at;

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), c.legacy_table, c.legacy_id, f.flag, f.detail
  from legacy_v.contacts c
  left join public.account acc on acc.tenant_id = migration.tenant_id()
        and acc.legacy_table = migration.lt('accounts') and acc.legacy_id = c.account_legacy_id
  cross join lateral (values
    (case when migration.looks_test(c.first_name, c.last_name, c.notes, c.email) then 'test_row' end,
     concat_ws(' ', c.first_name, c.last_name, '/', c.notes)),
    (case when c.account_legacy_id is not null and acc.id is null then 'orphan' end,
     'V2 account ' || c.account_legacy_id || ' does not exist; migrated unlinked')) f(flag, detail)
 where migration.in_scope(c.org_id) and f.flag is not null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

select migration.note_actors('contacts', 'created_by_legacy_user_id', 'created_by');
