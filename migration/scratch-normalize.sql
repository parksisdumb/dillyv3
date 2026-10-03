-- scratch-normalize.sql — runs in the SCRATCH database after the V2 public schema was restored and renamed to `legacy`.
-- Makes `legacy` self-contained so it restores cleanly into the NEW project:
--   * every column whose type lives outside pg_catalog (V2 enums, domains, citext, ...) becomes text (arrays -> text[]);
--     enum labels are preserved verbatim as text — the value maps work on text anyway
--   * generated columns become plain columns (values kept), defaults and identities are dropped
--   * V2 functions, triggers, policies, views and types are dropped (they stay documented in v2-schema.sql)
-- Data is never changed: row counts are verified by 03-restore-legacy.sh before and after.
\set ON_ERROR_STOP on
do $$
declare r record; n int := 0;
begin
  for r in select c.relname, p.polname from pg_policy p join pg_class c on c.oid = p.polrelid
            join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'legacy' loop
    execute format('drop policy %I on legacy.%I', r.polname, r.relname);
  end loop;
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'legacy' and c.relkind in ('r','p') loop
    execute format('alter table legacy.%I disable row level security', r.relname);
  end loop;
  for r in select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
            join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'legacy' and not t.tgisinternal loop
    execute format('drop trigger %I on legacy.%I', r.tgname, r.relname);
  end loop;
  for r in select c.relname, k.conname from pg_constraint k join pg_class c on c.oid = k.conrelid
            join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'legacy' and k.contype = 'f' loop
    execute format('alter table legacy.%I drop constraint %I', r.relname, r.conname);
  end loop;
  for r in select c.relname, c.relkind from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'legacy' and c.relkind in ('v','m') loop
    execute format('drop %s if exists legacy.%I cascade', case r.relkind when 'm' then 'materialized view' else 'view' end, r.relname);
  end loop;

  -- Columns: generated -> plain, identity -> plain, defaults dropped, non-catalog types -> built-in.
  for r in
    select c.relname, a.attname, a.attgenerated, a.attidentity, a.atthasdef,
           t.typtype, t.typcategory, tn.nspname as typ_schema,
           bt.oid as base_oid, btn.nspname as base_schema, format_type(t.typbasetype, t.typtypmod) as base_type,
           et.oid as elem_oid, etn.nspname as elem_schema
      from pg_class c join pg_namespace s on s.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      join pg_type t on t.oid = a.atttypid join pg_namespace tn on tn.oid = t.typnamespace
      left join pg_type bt on bt.oid = t.typbasetype left join pg_namespace btn on btn.oid = bt.typnamespace
      left join pg_type et on et.oid = t.typelem and t.typcategory = 'A' left join pg_namespace etn on etn.oid = et.typnamespace
     where s.nspname = 'legacy' and c.relkind in ('r','p')
  loop
    if r.attgenerated <> '' then
      execute format('alter table legacy.%I alter column %I drop expression', r.relname, r.attname);
    end if;
    if r.attidentity <> '' then
      execute format('alter table legacy.%I alter column %I drop identity if exists', r.relname, r.attname);
    end if;
    if r.atthasdef then
      execute format('alter table legacy.%I alter column %I drop default', r.relname, r.attname);
    end if;
    if r.typtype = 'd' and r.base_schema = 'pg_catalog' then
      execute format('alter table legacy.%I alter column %I type %s using %I::%s', r.relname, r.attname, r.base_type, r.attname, r.base_type);
      n := n + 1;
    elsif r.typcategory = 'A' and r.elem_schema is distinct from 'pg_catalog' and r.elem_oid is not null then
      execute format('alter table legacy.%I alter column %I type text[] using %I::text[]', r.relname, r.attname, r.attname);
      n := n + 1;
    elsif r.typ_schema <> 'pg_catalog' then
      execute format('alter table legacy.%I alter column %I type text using %I::text', r.relname, r.attname, r.attname);
      n := n + 1;
    end if;
  end loop;
  raise notice 'normalized % column types to built-in types', n;

  for r in select p.oid::regprocedure::text as sig, p.prokind from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname = 'legacy' loop
    execute format('drop %s if exists %s cascade',
                   case r.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, r.sig);
  end loop;
  for r in select t.typname from pg_type t join pg_namespace s on s.oid = t.typnamespace
            left join pg_class tc on tc.oid = t.typrelid
            where s.nspname = 'legacy' and (t.typtype in ('e','d','r') or (t.typtype = 'c' and tc.relkind = 'c')) loop
    execute format('drop type if exists legacy.%I cascade', r.typname);
  end loop;
end $$;
