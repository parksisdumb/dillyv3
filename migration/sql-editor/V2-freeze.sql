-- =====================================================================================================================
-- V2-freeze.sql — CUTOVER (Friday 17:00). Run in the OLD Dilly V2 project (Supabase → V2 project → SQL Editor).
-- Safe to re-run. Undo with V2-unfreeze.sql.
--
-- Makes V2 read-only for the app: revokes INSERT/UPDATE/DELETE/TRUNCATE on every public table from anon and
-- authenticated (reps), and from service_role too (stops V2's Gmail sync, agents and crons from writing). Reads keep
-- working, so V2 stays reachable as "old Dilly (read-only)". No business data is changed.
-- The exact grants in force before the freeze are saved first (schema dilly_cutover), so unfreeze restores them.
-- =====================================================================================================================

do $freeze$
declare
  freeze_service_role boolean := true;   -- false = V2's own background jobs may still write
  v_roles text[];
  v_n int;
begin
  if to_regprocedure('app.reconcile_tasks(uuid)') is not null then
    raise exception 'This is the NEW Dilly project. Run V2-freeze.sql in the OLD Dilly V2 project.';
  end if;
  if to_regclass('public.touchpoints') is null then
    raise exception 'public.touchpoints not found: this does not look like Dilly V2.';
  end if;
  v_roles := array['anon', 'authenticated'] || case when freeze_service_role then array['service_role'] else '{}'::text[] end;

  create schema if not exists dilly_cutover;
  create table if not exists dilly_cutover.saved_grant (
    table_name text not null, grantee text not null, privilege_type text not null,
    saved_at timestamptz not null default now(), primary key (table_name, grantee, privilege_type));
  -- Save only on the first freeze (a re-run must not overwrite the original grants with the frozen ones).
  if not exists (select 1 from dilly_cutover.saved_grant) then
    insert into dilly_cutover.saved_grant(table_name, grantee, privilege_type)
    select table_name, grantee, privilege_type from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    on conflict do nothing;
  end if;
  revoke all on schema dilly_cutover from public;

  execute format('revoke insert, update, delete, truncate on all tables in schema public from %s',
                 (select string_agg(quote_ident(x), ', ') from unnest(v_roles) x where exists (select 1 from pg_roles where rolname = x)));
  get diagnostics v_n = row_count;
  raise notice 'V2 frozen for %', v_roles;
end $freeze$;

select count(*) filter (where has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
                         or has_table_privilege('authenticated', c.oid, 'DELETE')) as tables_still_writable_by_reps,
       count(*) as public_tables,
       (select count(*) from dilly_cutover.saved_grant) as grants_saved_for_unfreeze,
       'next: 06-delta.sql in the NEW project' as next_step
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p');
