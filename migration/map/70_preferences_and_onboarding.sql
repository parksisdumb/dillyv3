-- 70_preferences_and_onboarding.sql — V2 account status -> account_preference; V2 onboarding ladder -> account.onboarding_status.
-- Onboarding is set here (not in 10) so it is applied after touches: migrated touches never bump onboarding,
-- and the onboarding points trigger skips source dillyv2. Idempotent.

update public.account a
   set onboarding_status = m.new_status
  from (select v.legacy_table, v.legacy_id, migration.map('onboarding_status', v.onboarding_status) as new_status
          from legacy_v.accounts v where migration.in_scope(v.org_id)) m
 where a.tenant_id = migration.tenant_id() and a.legacy_table = m.legacy_table and a.legacy_id = m.legacy_id
   and a.onboarding_status is distinct from m.new_status;

-- Preferences: only rows whose V2 status maps to a preference. A preference someone set in the new app
-- (set_by not null) is never overwritten by a re-run.
insert into public.account_preference as p (tenant_id, account_id, preference, reason, set_by, set_at)
select migration.tenant_id(), a.id, m.pref, 'Dilly V2 status: ' || m.status, null, coalesce(m.updated_at, now())
  from (select v.legacy_table, v.legacy_id, v.status, v.updated_at, migration.map('account_status', v.status) as pref
          from legacy_v.accounts v where migration.in_scope(v.org_id)) m
  join public.account a on a.tenant_id = migration.tenant_id() and a.legacy_table = m.legacy_table and a.legacy_id = m.legacy_id
 where m.pref is not null
on conflict (tenant_id, account_id) do update
   set preference = excluded.preference, reason = excluded.reason, set_at = excluded.set_at
 where p.set_by is null and p.reason like 'Dilly V2 status:%';
