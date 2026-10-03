-- scratch-stubs.sql — applied to the throwaway SCRATCH database before the V2 dump is restored into it.
-- Supabase tables reference platform objects (auth.users, auth.uid(), extensions.uuid_generate_v4(), citext...).
-- These stubs let CREATE TABLE succeed on plain Postgres. Nothing here reaches the NEW project:
-- 03-restore-legacy.sh converts every column to a built-in type and drops defaults before copying `legacy` across.
-- If a V2 table fails to create in scratch (see restore-scratch.log), add the missing stub here and re-run.
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

do $$ begin
  begin create extension if not exists "uuid-ossp" schema extensions; exception when others then null; end;
  begin create extension if not exists pgcrypto schema extensions;    exception when others then null; end;
  begin create extension if not exists citext schema extensions;      exception when others then null; end;
  begin create extension if not exists pg_trgm schema extensions;     exception when others then null; end;
end $$;

do $$ begin
  if to_regprocedure('extensions.uuid_generate_v4()') is null then
    create function extensions.uuid_generate_v4() returns uuid language sql as 'select gen_random_uuid()';
  end if;
  if to_regprocedure('extensions.gen_random_uuid()') is null then
    create function extensions.gen_random_uuid() returns uuid language sql as 'select pg_catalog.gen_random_uuid()';
  end if;
end $$;

create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
create or replace function auth.role() returns text language sql stable as 'select null::text';
create or replace function auth.email() returns text language sql stable as 'select null::text';
create or replace function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
exception when insufficient_privilege then null;
end $$;
