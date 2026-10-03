-- 05-unfreeze-v2.sql — undo 05-freeze-v2.sql on the V2 project (rollback of a cutover).
--
--   psql "$V2_DB_URL" -v ON_ERROR_STOP=1 -v grants_file=migration/out/v2-grants-before-freeze.sql -f migration/05-unfreeze-v2.sql
--
-- With grants_file: replays the exact grants saved at freeze time. Without it: restores Supabase's defaults
-- (INSERT/UPDATE/DELETE for anon and authenticated, all for service_role); RLS policies still govern rows.
\set ON_ERROR_STOP on
do $$ begin
  if to_regprocedure('app.reconcile_tasks(uuid)') is not null then
    raise exception 'this looks like the NEW Dilly database — unfreeze is for the V2 project only';
  end if;
end $$;

begin;
\if :{?grants_file}
  \echo 'replaying saved grants from' :grants_file
  \i :grants_file
\else
  \echo 'no grants_file given: restoring Supabase default write grants'
  grant insert, update, delete on all tables in schema public to anon, authenticated;
  grant insert, update, delete, truncate on all tables in schema public to service_role;
\endif
commit;

select count(*) filter (where has_table_privilege('authenticated', c.oid, 'INSERT')) as tables_writable_by_authenticated,
       count(*) as public_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p');
