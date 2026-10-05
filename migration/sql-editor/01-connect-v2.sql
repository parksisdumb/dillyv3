-- =====================================================================================================================
-- 01-connect-v2.sql — run in the NEW Dilly project (Supabase → SQL Editor → New query → paste → Run).
--
-- Copies the whole Dilly V2 database (schema public, every org) into schema `legacy` of the NEW project, once:
--   * connects to V2 with postgres_fdw (server dilly_v2, read-only: the script only ever SELECTs from V2)
--   * imports V2's tables as foreign tables into schema legacy_fdw
--   * materializes every V2 table as a real table legacy.<name> (+ its primary key), inside ONE transaction, so the
--     copy is a consistent point-in-time snapshot and V2 is read exactly once
--   * records the snapshot time and every table's source row count in migration.snapshot / migration.snapshot_table
-- Only the FOX org is migrated later (02/03); the other orgs' rows stay in legacy and are never read.
--
-- BEFORE YOU RUN: fill in the 4 values marked <...> below. Get them from the V2 project:
--   Supabase → (V2 project) → Connect (top bar) → "Session pooler" → View parameters:
--       host  = aws-0-<region>.pooler.supabase.com      port = 5432      user = postgres.<v2-project-ref>
--   Password = the V2 database password (Project Settings → Database → Reset database password if nobody has it).
-- Type the password HERE ONLY. Never paste it into a chat. After the run: clear it from this editor tab, and run
-- 05-drop-fdw.sql (removes the stored connection). Re-running this script after a successful copy changes nothing
-- (it stops with a message); for changes made in V2 since, use 06-delta.sql.
-- =====================================================================================================================

set statement_timeout = 0;

do $copy$
declare
  -- >>> FILL IN (V2 project → Connect → Session pooler) ---------------------------------------------------------------
  v2_host     text := '<V2_POOLER_HOST>';        -- e.g. aws-0-us-east-1.pooler.supabase.com
  v2_port     text := '5432';
  v2_dbname   text := 'postgres';
  v2_user     text := '<V2_POOLER_USER>';        -- postgres.<v2-project-ref>
  v2_password text := '<V2_DB_PASSWORD>';
  v2_sslmode  text := 'require';
  -- <<< ----------------------------------------------------------------------------------------------------------------
  v_snap   bigint;
  v_at     timestamptz := clock_timestamp();
  v_rows   bigint;
  v_total  bigint := 0;
  v_tables int := 0;
  v_pk     text[];
  r        record;
begin
  if v2_host like '<%' or v2_user like '<%' or v2_password like '<%' then
    raise exception 'Fill in v2_host, v2_user and v2_password at the top of 01-connect-v2.sql (V2 project -> Connect -> Session pooler).';
  end if;
  if to_regprocedure('app.reconcile_tasks(uuid)') is null then
    raise exception 'Run this in the NEW Dilly project (app.reconcile_tasks not found here).';
  end if;

  create schema if not exists extensions;
  create extension if not exists postgres_fdw with schema extensions;
  create schema if not exists migration;
  create schema if not exists legacy;
  create table if not exists migration.settings (key text primary key, value text, note text);
  create table if not exists migration.snapshot (
    id          bigserial primary key,
    kind        text not null check (kind in ('full', 'delta')),
    taken_at    timestamptz not null,           -- V2 state as of (just before) this moment
    finished_at timestamptz,
    detail      jsonb not null default '{}'::jsonb
  );
  create table if not exists migration.snapshot_table (
    snapshot_id bigint not null references migration.snapshot(id),
    table_name  text not null,
    source_rows bigint not null,                -- rows in V2 at the snapshot (every org)
    pk_cols     text[],
    changed     int,                            -- delta only
    inserted    int,
    missing_in_v2 int,
    primary key (snapshot_id, table_name)
  );

  if exists (select 1 from migration.snapshot where kind = 'full' and finished_at is not null) then
    if exists (select 1 from public.touch where source = 'dillyv2' limit 1)
       or exists (select 1 from public.account where source = 'dillyv2' limit 1) then
      raise exception 'V2 was already copied (%), and transformed. Nothing changed. For V2 changes since then run 06-delta.sql.',
        (select max(taken_at) from migration.snapshot where kind = 'full');
    end if;
    raise notice 'replacing the earlier copy (nothing was transformed from it yet)';
  end if;

  -- Connection: read-only foreign server (updatable false), credentials only in the user mapping.
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

  -- Is this really Dilly V2 (and not the new project)?
  if not exists (select 1 from legacy_fdw."_v2_tables" where table_schema = 'public' and table_name = 'touchpoints')
     or not exists (select 1 from legacy_fdw."_v2_tables" where table_schema = 'public' and table_name = 'orgs') then
    raise exception 'The database at % does not look like Dilly V2 (no public.touchpoints / public.orgs). Check the host and user.', v2_host;
  end if;
  if exists (select 1 from legacy_fdw."_v2_tables" where table_schema = 'public' and table_name = 'touch') then
    raise exception 'The database at % has public.touch: that is a NEW Dilly project, not V2.', v2_host;
  end if;

  insert into migration.snapshot(kind, taken_at) values ('full', v_at) returning id into v_snap;

  for r in select table_name::text as t from legacy_fdw."_v2_tables"
            where table_schema = 'public' and table_type = 'BASE TABLE' order by 1 loop
    if to_regclass(format('legacy_fdw.%I', r.t)) is null then
      raise exception 'V2 table % was not imported (unsupported column type?)', r.t;
    end if;
    if to_regclass(format('legacy.%I', r.t)) is not null then
      execute format('drop table legacy.%I cascade', r.t);
    end if;
    execute format('create table legacy.%I as select * from legacy_fdw.%I', r.t, r.t);
    get diagnostics v_rows = row_count;
    select array_agg(k.column_name::text order by k.ordinal_position) into v_pk
      from legacy_fdw."_v2_constraints" c
      join legacy_fdw."_v2_key_columns" k on k.constraint_schema = c.constraint_schema and k.constraint_name = c.constraint_name
                                          and k.table_schema = c.table_schema and k.table_name = c.table_name
     where c.table_schema = 'public' and c.table_name = r.t and c.constraint_type = 'PRIMARY KEY';
    if v_pk is not null then
      execute format('alter table legacy.%I add primary key (%s)', r.t,
                     (select string_agg(quote_ident(x), ', ') from unnest(v_pk) x));
    end if;
    insert into migration.snapshot_table(snapshot_id, table_name, source_rows, pk_cols) values (v_snap, r.t, v_rows, v_pk);
    v_total := v_total + v_rows; v_tables := v_tables + 1;
    raise notice 'copied % (% rows)', r.t, v_rows;
  end loop;

  update migration.snapshot set finished_at = clock_timestamp(),
         detail = jsonb_build_object('tables', v_tables, 'rows', v_total, 'v2_host', v2_host)
   where id = v_snap;

  -- Never expose the raw copy or the connection through the API roles.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on schema legacy, legacy_fdw, migration from anon;
    revoke all on all tables in schema legacy from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on schema legacy, legacy_fdw, migration from authenticated;
    revoke all on all tables in schema legacy from authenticated;
  end if;
  raise notice 'V2 copied: % tables, % rows, snapshot %', v_tables, v_total, v_at;
end $copy$;

-- Result: every V2 table copied, with its V2 row count at the snapshot and the rows now in legacy.
select st.table_name,
       st.source_rows as v2_rows,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from legacy.%I', st.table_name), false, true, '')))[1]::text::bigint as copied_rows,
       array_to_string(st.pk_cols, ', ') as primary_key,
       s.taken_at as snapshot_at
  from migration.snapshot_table st join migration.snapshot s on s.id = st.snapshot_id
 where s.id = (select max(id) from migration.snapshot where kind = 'full')
 order by st.table_name;
