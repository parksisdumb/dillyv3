-- =====================================================================================================================
-- 05-drop-fdw.sql — run in the NEW Dilly project right after 01-connect-v2.sql succeeded. Safe to re-run.
--
-- Removes the connection to V2: the foreign tables (schema legacy_fdw), the user mapping that holds the V2 password,
-- and the foreign server. The copy in schema `legacy` stays forever. 06-delta.sql re-creates the connection for the
-- cutover and removes it again by itself.
-- Also clears pg_stat_statements (if installed), whose query log would otherwise keep the text of 01, password included.
-- =====================================================================================================================

do $drop$
begin
  drop schema if exists legacy_fdw cascade;
  if exists (select 1 from pg_foreign_server where srvname = 'dilly_v2') then
    drop server dilly_v2 cascade;      -- drops every user mapping (credentials) with it
  end if;
  begin
    if to_regprocedure('extensions.pg_stat_statements_reset(oid,oid,bigint)') is not null then
      perform extensions.pg_stat_statements_reset();
    elsif to_regprocedure('public.pg_stat_statements_reset(oid,oid,bigint)') is not null then
      perform public.pg_stat_statements_reset();
    end if;
  exception when others then
    raise notice 'could not reset pg_stat_statements (%); reset the V2 database password after cutover', sqlerrm;
  end;
end $drop$;

select 'V2 connection removed' as check,
       case when exists (select 1 from pg_foreign_server where srvname = 'dilly_v2')
              or exists (select 1 from pg_user_mappings where srvname = 'dilly_v2')
            then 'FAIL: still present' else 'PASS: no V2 server or credentials stored' end as value
union all
select 'legacy copy kept', (select count(*) || ' tables in schema legacy' from pg_tables where schemaname = 'legacy');
