-- =====================================================================================================================
-- 06-delta.sql — CUTOVER: run in the NEW Dilly project after V2 is frozen (V2-freeze.sql in the V2 project).
-- Safe to re-run.
--
-- Re-connects to V2 (same 4 values as 01), compares every V2 table with the copy in `legacy`, and brings over what
-- changed since the snapshot:
--   * changed rows: the previous legacy version is archived to legacy._superseded (jsonb), then replaced
--   * new rows are added; new V2 columns are added to the legacy table; new V2 tables are copied whole
--   * rows deleted in V2 are LISTED in legacy._delta_missing and never removed (copy, never move)
-- The comparison is by primary key over whole rows, so it also catches edits that did not bump updated_at.
-- Then it removes the V2 connection again (no credentials remain). Everything runs in one transaction.
--
-- NEXT: run 02-preflight.sql, 03-transform.sql, 04-reconcile.sql again (04 must say PASS).
-- =====================================================================================================================

set statement_timeout = 0;

do $delta$
declare
  -- >>> FILL IN (V2 project → Connect → Session pooler) ---------------------------------------------------------------
  v2_host     text := '<V2_POOLER_HOST>';
  v2_port     text := '5432';
  v2_dbname   text := 'postgres';
  v2_user     text := '<V2_POOLER_USER>';
  v2_password text := '<V2_DB_PASSWORD>';
  v2_sslmode  text := 'require';
  -- <<< ----------------------------------------------------------------------------------------------------------------
  v_snap    bigint;
  v_since   timestamptz;
  v_at      timestamptz := clock_timestamp();
  r         record;
  c         record;
  v_pk      text[];
  v_pkexpr  text;
  v_cols    text;
  v_collist text;
  v_changed int; v_new int; v_missing int; v_rows bigint;
  v_tot_changed int := 0; v_tot_new int := 0; v_tot_missing int := 0;
begin
  if v2_host like '<%' or v2_user like '<%' or v2_password like '<%' then
    raise exception 'Fill in v2_host, v2_user and v2_password at the top of 06-delta.sql (V2 project -> Connect -> Session pooler).';
  end if;
  select max(taken_at) into v_since from migration.snapshot where finished_at is not null;
  if v_since is null then
    raise exception 'No snapshot yet: run 01-connect-v2.sql first.';
  end if;

  create schema if not exists extensions;
  create extension if not exists postgres_fdw with schema extensions;
  drop server if exists dilly_v2 cascade;
  execute format('create server dilly_v2 foreign data wrapper postgres_fdw options (host %L, port %L, dbname %L, sslmode %L, fetch_size %L, updatable %L)',
                 v2_host, v2_port, v2_dbname, v2_sslmode, '5000', 'false');
  execute format('create user mapping for current_user server dilly_v2 options (user %L, password %L)', v2_user, v2_password);
  drop schema if exists legacy_fdw cascade;
  create schema legacy_fdw;
  import foreign schema public from server dilly_v2 into legacy_fdw;
  create foreign table legacy_fdw."_v2_tables" (table_schema text, table_name text, table_type text)
    server dilly_v2 options (schema_name 'information_schema', table_name 'tables');
  create foreign table legacy_fdw."_v2_constraints" (constraint_schema text, constraint_name text, table_schema text, table_name text, constraint_type text)
    server dilly_v2 options (schema_name 'information_schema', table_name 'table_constraints');
  create foreign table legacy_fdw."_v2_key_columns" (constraint_schema text, constraint_name text, table_schema text, table_name text, column_name text, ordinal_position int)
    server dilly_v2 options (schema_name 'information_schema', table_name 'key_column_usage');
  if not exists (select 1 from legacy_fdw."_v2_tables" where table_schema = 'public' and table_name = 'touchpoints')
     or exists (select 1 from legacy_fdw."_v2_tables" where table_schema = 'public' and table_name = 'touch') then
    raise exception 'The database at % is not Dilly V2. Check the host and user.', v2_host;
  end if;

  create table if not exists legacy._superseded (table_name text not null, row_pk text, row_data jsonb not null,
                                                 snapshot_id bigint, superseded_at timestamptz not null default now());
  create table if not exists legacy._delta_missing (table_name text not null, row_pk text not null, row_data jsonb,
                                                    noticed_at timestamptz not null default now(), primary key (table_name, row_pk));

  insert into migration.snapshot(kind, taken_at, detail) values ('delta', v_at, jsonb_build_object('since', v_since)) returning id into v_snap;

  for r in select table_name::text as t from legacy_fdw."_v2_tables"
            where table_schema = 'public' and table_type = 'BASE TABLE' order by 1 loop
    select array_agg(k.column_name::text order by k.ordinal_position) into v_pk
      from legacy_fdw."_v2_constraints" cn
      join legacy_fdw."_v2_key_columns" k on k.constraint_schema = cn.constraint_schema and k.constraint_name = cn.constraint_name
                                          and k.table_schema = cn.table_schema and k.table_name = cn.table_name
     where cn.table_schema = 'public' and cn.table_name = r.t and cn.constraint_type = 'PRIMARY KEY';

    if to_regclass(format('legacy.%I', r.t)) is null then
      -- a table V2 gained after the snapshot: copy it whole
      execute format('create table legacy.%I as select * from legacy_fdw.%I', r.t, r.t);
      get diagnostics v_rows = row_count;
      if v_pk is not null then
        execute format('alter table legacy.%I add primary key (%s)', r.t, (select string_agg(quote_ident(x), ', ') from unnest(v_pk) x));
      end if;
      insert into migration.snapshot_table(snapshot_id, table_name, source_rows, pk_cols, changed, inserted, missing_in_v2)
      values (v_snap, r.t, v_rows, v_pk, 0, v_rows, 0);
      v_tot_new := v_tot_new + v_rows;
      raise notice 'new V2 table % copied (% rows): classify it in 02-preflight.sql', r.t, v_rows;
      continue;
    end if;

    execute format('create temp table _stage on commit drop as select * from legacy_fdw.%I', r.t);
    get diagnostics v_rows = row_count;

    -- columns V2 gained since the snapshot are added to the legacy table (nothing is lost)
    for c in select a.attname, format_type(a.atttypid, a.atttypmod) as typ
               from pg_attribute a where a.attrelid = '_stage'::regclass and a.attnum > 0 and not a.attisdropped
                and not exists (select 1 from pg_attribute b where b.attrelid = format('legacy.%I', r.t)::regclass
                                  and b.attname = a.attname and b.attnum > 0 and not b.attisdropped) loop
      execute format('alter table legacy.%I add column %I %s', r.t, c.attname, c.typ);
      raise notice 'legacy.% gained column %', r.t, c.attname;
    end loop;
    -- legacy columns, in order; a column V2 dropped is kept and filled with null for new rows
    select string_agg(case when exists (select 1 from pg_attribute s where s.attrelid = '_stage'::regclass and s.attname = b.attname and s.attnum > 0 and not s.attisdropped)
                           then format('s.%I', b.attname) else 'null' end, ', ' order by b.attnum),
           string_agg(format('%I', b.attname), ', ' order by b.attnum)
      into v_cols, v_collist
      from pg_attribute b where b.attrelid = format('legacy.%I', r.t)::regclass and b.attnum > 0 and not b.attisdropped;

    if v_pk is null then
      v_pk := (select array_agg(attname::text order by attnum) from pg_attribute
                where attrelid = format('legacy.%I', r.t)::regclass and attnum > 0 and not attisdropped);
    end if;
    v_pkexpr := (select string_agg(format('%s.%I::text', '%1$s', x), ' || '':'' || ') from unnest(v_pk) x);

    -- changed rows: archive the old version, replace it
    execute format($q$
      with chg as (
        select l.ctid as lctid, %1$s as pk, to_jsonb(l) as old_row
          from legacy.%2$I l join _stage s using (%3$s)
         where to_jsonb(l) - (select coalesce(array_agg(k), '{}') from jsonb_object_keys(to_jsonb(l)) k where not (to_jsonb(s) ? k))
               is distinct from to_jsonb(s) - (select coalesce(array_agg(k), '{}') from jsonb_object_keys(to_jsonb(s)) k where not (to_jsonb(l) ? k))
      ), arch as (
        insert into legacy._superseded(table_name, row_pk, row_data, snapshot_id) select %4$L, pk, old_row, %5$s from chg returning 1
      )
      delete from legacy.%2$I l using chg where l.ctid = chg.lctid$q$,
      format(v_pkexpr, 'l'), r.t, (select string_agg(quote_ident(x), ', ') from unnest(v_pk) x), r.t, v_snap);
    get diagnostics v_changed = row_count;

    -- new + changed rows in
    execute format($q$insert into legacy.%1$I (%2$s) select %3$s from _stage s
                       where not exists (select 1 from legacy.%1$I l where (%4$s) = (%5$s))$q$,
                   r.t, v_collist, v_cols,
                   (select string_agg(format('l.%I', x), ', ') from unnest(v_pk) x),
                   (select string_agg(format('s.%I', x), ', ') from unnest(v_pk) x));
    get diagnostics v_new = row_count;
    v_new := v_new - v_changed;

    -- deleted in V2: listed, never removed
    execute format($q$insert into legacy._delta_missing(table_name, row_pk, row_data)
                      select %1$L, %2$s, to_jsonb(l) from legacy.%3$I l
                       where not exists (select 1 from _stage s where (%4$s) = (%5$s))
                      on conflict (table_name, row_pk) do nothing$q$,
                   r.t, format(v_pkexpr, 'l'), r.t,
                   (select string_agg(format('l.%I', x), ', ') from unnest(v_pk) x),
                   (select string_agg(format('s.%I', x), ', ') from unnest(v_pk) x));
    execute format($q$select count(*) from legacy.%1$I l where not exists (select 1 from _stage s where (%2$s) = (%3$s))$q$,
                   r.t, (select string_agg(format('l.%I', x), ', ') from unnest(v_pk) x),
                   (select string_agg(format('s.%I', x), ', ') from unnest(v_pk) x)) into v_missing;

    insert into migration.snapshot_table(snapshot_id, table_name, source_rows, pk_cols, changed, inserted, missing_in_v2)
    values (v_snap, r.t, v_rows, v_pk, v_changed, v_new, v_missing);
    v_tot_changed := v_tot_changed + v_changed; v_tot_new := v_tot_new + v_new; v_tot_missing := v_tot_missing + v_missing;
    if v_changed + v_new + v_missing > 0 then
      raise notice '%: % changed, % new, % gone from V2 (kept)', r.t, v_changed, v_new, v_missing;
    end if;
    drop table _stage;
  end loop;

  update migration.snapshot set finished_at = clock_timestamp(),
         detail = detail || jsonb_build_object('changed', v_tot_changed, 'new', v_tot_new, 'missing_in_v2', v_tot_missing)
   where id = v_snap;

  -- Remove the connection again: no V2 credentials remain in this project.
  drop schema legacy_fdw cascade;
  drop server dilly_v2 cascade;
  if exists (select 1 from pg_roles where rolname = 'anon') then revoke all on all tables in schema legacy from anon; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then revoke all on all tables in schema legacy from authenticated; end if;
  raise notice 'delta since %: % changed, % new, % gone from V2 (kept). Now run 02, 03, 04.', v_since, v_tot_changed, v_tot_new, v_tot_missing;
end $delta$;

select st.table_name, st.source_rows as v2_rows, st.changed, st.inserted as new_rows, st.missing_in_v2 as gone_from_v2_kept,
       'next: run 02-preflight.sql, 03-transform.sql, 04-reconcile.sql' as next_step
  from migration.snapshot_table st
 where st.snapshot_id = (select max(id) from migration.snapshot where kind = 'delta')
   and (st.changed + st.inserted + st.missing_in_v2) > 0
union all
select '(total)', null, sum(changed), sum(inserted), sum(missing_in_v2), 'next: run 02-preflight.sql, 03-transform.sql, 04-reconcile.sql'
  from migration.snapshot_table where snapshot_id = (select max(id) from migration.snapshot where kind = 'delta')
order by 1;
