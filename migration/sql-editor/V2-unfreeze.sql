-- =====================================================================================================================
-- V2-unfreeze.sql — ROLLBACK ONLY. Run in the OLD Dilly V2 project. Restores exactly the write grants that
-- V2-freeze.sql saved, so reps can work in V2 again. Safe to re-run.
-- =====================================================================================================================

do $unfreeze$
declare r record; v_n int := 0;
begin
  if to_regprocedure('app.reconcile_tasks(uuid)') is not null then
    raise exception 'This is the NEW Dilly project. Run V2-unfreeze.sql in the OLD Dilly V2 project.';
  end if;
  if to_regclass('dilly_cutover.saved_grant') is null or not exists (select 1 from dilly_cutover.saved_grant) then
    raise exception 'No saved grants: V2-freeze.sql was never run here.';
  end if;
  for r in select * from dilly_cutover.saved_grant order by table_name, grantee, privilege_type loop
    if to_regclass(format('public.%I', r.table_name)) is not null and exists (select 1 from pg_roles where rolname = r.grantee) then
      execute format('grant %s on table public.%I to %I', r.privilege_type, r.table_name, r.grantee);
      v_n := v_n + 1;
    end if;
  end loop;
  delete from dilly_cutover.saved_grant;   -- the next freeze saves afresh
  raise notice 'restored % grants', v_n;
end $unfreeze$;

select count(*) filter (where has_table_privilege('authenticated', c.oid, 'INSERT')) as tables_writable_by_reps,
       count(*) as public_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p');
