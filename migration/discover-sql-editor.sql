-- Dilly V2 schema discovery for the Supabase SQL editor (no psql needed). READ-ONLY.
-- Run in the OLD Dilly V2 project: Supabase dashboard -> SQL Editor -> paste -> Run.
-- Then click "Copy" (or Export -> CSV) on the result and send it to Claude.
with
tables as (
  select c.oid, c.relname,
         (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text as n
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relkind in ('r','p')
),
cols as (
  select t.relname, a.attnum, a.attname,
         format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as notnull,
         pg_get_expr(d.adbin, d.adrelid) as dflt
    from tables t join pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),
lines as (
  select 1 as s, relname as k, 0 as o, 'TABLE ' || relname || ' — ' || n || ' rows' as line from tables
  union all
  select 2, relname, attnum, '  ' || relname || '.' || attname || ' ' || typ || case when notnull then ' NOT NULL' else '' end
         || coalesce(' DEFAULT ' || dflt, '') from cols
  union all
  select 3, conrelid::regclass::text, 0, '  CONSTRAINT ' || conrelid::regclass::text || ' ' || conname || ': ' || pg_get_constraintdef(oid)
    from pg_constraint where connamespace = 'public'::regnamespace and contype in ('c','f','u','p')
  union all
  select 4, t.typname, e.enumsortorder::int, '  ENUM ' || t.typname || ' = ' || e.enumlabel
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace ns on ns.oid = t.typnamespace
   where ns.nspname = 'public'
  union all
  select 5, p.proname, 0, '  FUNCTION ' || p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 6, event_object_table, 0, '  TRIGGER ' || event_object_table || ' ' || trigger_name || ' ' || action_timing || ' ' || event_manipulation
    from information_schema.triggers where event_object_schema = 'public'
)
select line from lines order by s, k, o, line;
