-- 05-freeze-v2.sql — run ON THE V2 PROJECT at cutover (Friday 17:00) to make it read-only for the app.
-- Reversible with 05-unfreeze-v2.sql. Revokes INSERT/UPDATE/DELETE/TRUNCATE on every public table from the API
-- roles (anon, authenticated; plus service_role when -v freeze_service_role=1, which also stops V2's Gmail sync and
-- crons). Reads keep working: V2 stays reachable as "old Dilly (read-only)". No data is changed.
--
--   psql "$V2_DB_URL" -v ON_ERROR_STOP=1 -v grants_file=migration/out/v2-grants-before-freeze.sql \
--        [-v freeze_service_role=1] -f migration/05-freeze-v2.sql
--
-- The current write grants are saved to :grants_file first so 05-unfreeze-v2.sql can restore them exactly.
\set ON_ERROR_STOP on
\if :{?grants_file}
\else
  \set grants_file 'v2-grants-before-freeze.sql'
\endif

do $$ begin
  if to_regprocedure('app.reconcile_tasks(uuid)') is not null then
    raise exception 'this looks like the NEW Dilly database (app.reconcile_tasks exists) — freeze is for the V2 project only';
  end if;
end $$;

\echo 'saving current write grants to' :grants_file
\pset tuples_only on
\pset format unaligned
\o :grants_file
select '-- write grants on V2 public tables before freeze, ' || now();
select format('grant %s on table %I.%I to %I;', privilege_type, table_schema, table_name, grantee)
  from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
 order by table_name, grantee, privilege_type;
\o
\pset tuples_only off
\pset format aligned

begin;
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
\if :{?freeze_service_role}
revoke insert, update, delete, truncate on all tables in schema public from service_role;
\echo 'service_role frozen too'
\endif
commit;

select count(*) filter (where has_table_privilege('authenticated', c.oid, 'INSERT') or has_table_privilege('authenticated', c.oid, 'UPDATE')
                         or has_table_privilege('authenticated', c.oid, 'DELETE')) as tables_still_writable_by_authenticated,
       count(*) as public_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p');
\echo 'V2 is frozen. Run migration/06-delta.sh now; unfreeze with migration/05-unfreeze-v2.sql if you must roll back.'
