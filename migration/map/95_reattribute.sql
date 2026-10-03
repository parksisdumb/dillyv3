-- 95_reattribute.sql — OPTIONAL, run only via `03b-transform.sh --reattribute`.
-- Touches by reps who had not signed in at migration time were loaded with user_id null (actor kept in
-- migration.unmapped_actor). Once those reps sign in (profile exists; 00_tenant_and_users marks the actor resolved),
-- this fills touch.user_id for exactly those rows.
--
-- The touch ledger is append-only (trigger touch_guard). This step lifts the guard for ONE statement inside the
-- migration transaction, only for dillyv2 touches whose user_id is null and whose V2 actor is now known.
-- No other column changes. Points are not awarded retroactively (migrated history never scores).

alter table public.touch disable trigger touch_guard;

with fix as (
  select x.id, a.resolved_profile_id
    from migration.unmapped_actor a
    join public.touch x on x.tenant_id = a.tenant_id and x.legacy_table = a.legacy_table and x.legacy_id = a.legacy_id
   where a.tenant_id = migration.tenant_id() and a.role_column = 'actor' and a.resolved_profile_id is not null
     and x.source = 'dillyv2' and x.user_id is null
)
update public.touch x set user_id = fix.resolved_profile_id from fix where x.id = fix.id;

alter table public.touch enable trigger touch_guard;

insert into migration.run_log(step, detail)
select 'reattribute', jsonb_build_object('touches_with_user',
  (select count(*) from public.touch where tenant_id = migration.tenant_id() and source = 'dillyv2' and user_id is not null));
