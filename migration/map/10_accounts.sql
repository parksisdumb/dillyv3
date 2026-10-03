-- 10_accounts.sql — legacy_v.accounts -> public.account. Idempotent upsert keyed on (tenant_id, legacy_table, legacy_id).
-- icp_tier = the V2 P1..P4 priority (kept verbatim; also stored in migration.legacy_value as legacy_priority).
-- score starts at 0: the V2 score is a different scale and is recomputed by the new ranking (legacy kept as legacy_score).
-- Freshness stamps (last/first_touch_at) come from 50_touches; onboarding + preference from 70.

insert into public.account as t (
  tenant_id, name, account_type, website, phone, address1, city, state, zip, icp_tier, score,
  owner_user_id, notes, source, legacy_table, legacy_id, is_test, created_by, created_at, updated_at)
select migration.tenant_id(),
       coalesce(nullif(btrim(a.name), ''), '(unnamed Dilly V2 account ' || a.legacy_id || ')'),
       migration.map('account_type', a.account_type),
       a.website, a.phone, a.address1, a.city, a.state, a.zip,
       migration.map('icp_priority', a.priority)::smallint,
       0,
       migration.uid(a.owner_legacy_user_id),
       a.notes,
       'dillyv2', a.legacy_table, a.legacy_id,
       migration.looks_test(a.name, a.notes, a.address1),
       migration.uid(a.created_by_legacy_user_id),
       coalesce(a.created_at, now()),
       coalesce(a.updated_at, a.created_at, now())
  from legacy_v.accounts a
 where migration.in_scope(a.org_id)
 order by a.created_at nulls last, a.legacy_id
on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
  name          = excluded.name,
  account_type  = excluded.account_type,
  website       = excluded.website,
  phone         = excluded.phone,
  address1      = excluded.address1, city = excluded.city, state = excluded.state, zip = excluded.zip,
  icp_tier      = excluded.icp_tier,
  owner_user_id = coalesce(excluded.owner_user_id, t.owner_user_id),
  notes         = excluded.notes,
  is_test       = excluded.is_test,
  created_by    = coalesce(excluded.created_by, t.created_by),
  created_at    = excluded.created_at;

insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
select migration.tenant_id(), 'account', t.id, a.legacy_table, a.legacy_id, f.field, f.value
  from legacy_v.accounts a
  join public.account t on t.tenant_id = migration.tenant_id() and t.legacy_table = a.legacy_table and t.legacy_id = a.legacy_id
  cross join lateral (values ('legacy_priority', a.priority), ('legacy_score', a.legacy_score), ('legacy_status', a.status),
                             ('legacy_onboarding_status', a.onboarding_status), ('legacy_type', a.account_type)) f(field, value)
 where migration.in_scope(a.org_id) and f.value is not null
on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), a.legacy_table, a.legacy_id, f.flag, f.detail
  from legacy_v.accounts a
  cross join lateral (values
    (case when migration.looks_test(a.name, a.notes, a.address1) then 'test_row' end, a.name),
    (case when nullif(btrim(a.name), '') is null then 'missing_name' end, 'placeholder name written')) f(flag, detail)
 where migration.in_scope(a.org_id) and f.flag is not null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

select migration.note_actors('accounts', 'owner_legacy_user_id', 'owner');
select migration.note_actors('accounts', 'created_by_legacy_user_id', 'created_by');
