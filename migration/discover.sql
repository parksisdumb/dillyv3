-- discover.sql — prints the shape of the Dilly V2 database as Markdown. READ-ONLY (no temp objects, no functions created).
-- Run through migration/02-discover.sh. psql variable :schema selects the schema to describe
-- ('public' on the V2 project; 'legacy' on the NEW project after 03-restore-legacy.sh).
\pset format unaligned
\pset tuples_only on
\pset footer off
\set QUIET on

select '# Dilly V2 — legacy schema discovery';
select '';
select '- Generated: ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') || ' from database `' || current_database()
       || '`, schema `' || :'schema' || '` (server ' || version() || ')';
select '- Confirm every assumption in `migration/map/legacy_views.sql` and `migration/map/value_maps.sql` against this file.';
select '';

-- ---------------------------------------------------------------------------
select '## 1. Tables and exact row counts';
select '';
select '| table | exact rows | n_live_tup | RLS on | comment |';
select '|---|---:|---:|---|---|';
select format('| %s | %s | %s | %s | %s |', c.relname,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text,
       coalesce(s.n_live_tup, 0), c.relrowsecurity, coalesce(replace(obj_description(c.oid, 'pg_class'), '|', '/'), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join pg_stat_user_tables s on s.relid = c.oid
 where n.nspname = :'schema' and c.relkind in ('r','p')
 order by c.relname;
select '';

-- ---------------------------------------------------------------------------
select '## 2. Columns';
select '';
select '| table | # | column | type | null | default |';
select '|---|---:|---|---|---|---|';
select format('| %s | %s | %s | %s | %s | %s |', c.relname, a.attnum, a.attname,
              format_type(a.atttypid, a.atttypmod)
                || case when t.typtype = 'e' then ' (enum)' when t.typtype = 'd' then ' (domain)' else '' end
                || case when a.atttypid = 'timestamp'::regtype then ' **NO TZ**' else '' end,
              case when a.attnotnull then 'not null' else '' end,
              coalesce(replace(pg_get_expr(d.adbin, d.adrelid), '|', '/'), ''))
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  join pg_type t on t.oid = a.atttypid
  left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
 where n.nspname = :'schema' and c.relkind in ('r','p')
 order by c.relname, a.attnum;
select '';

-- ---------------------------------------------------------------------------
select '## 3. Enum types';
select '';
select '| type | labels (in order) |';
select '|---|---|';
select format('| %s.%s | %s |', n.nspname, t.typname, string_agg(e.enumlabel, ' · ' order by e.enumsortorder))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace join pg_enum e on e.enumtypid = t.oid
 where n.nspname = :'schema'
 group by n.nspname, t.typname order by t.typname;
select '';

-- ---------------------------------------------------------------------------
select '## 4. Constraints (primary key, unique, check, foreign key)';
select '';
select '| table | constraint | type | definition |';
select '|---|---|---|---|';
select format('| %s | %s | %s | %s |', c.relname, k.conname,
              case k.contype when 'p' then 'PK' when 'u' then 'unique' when 'c' then 'check' when 'f' then 'FK' when 'x' then 'exclude' else k.contype::text end,
              replace(pg_get_constraintdef(k.oid), '|', '/'))
  from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema'
 order by c.relname, k.contype, k.conname;
select '';

-- ---------------------------------------------------------------------------
select '## 5. Value inventory (enum-like columns: distinct values with counts)';
select '';
select 'Every value below must have a row in `migration/map/value_maps.sql`, or 05_preflight will stop the migration.';
select '';
select '| table.column | value | rows |';
select '|---|---|---:|';
with cols as (
  select n.nspname, c.relname, a.attname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_type t on t.oid = a.atttypid
   where n.nspname = :'schema' and c.relkind in ('r','p')
     and (t.typtype = 'e'
          or (t.typname in ('text', 'varchar', 'bpchar', 'bool', 'citext')
              and a.attname ~* '(type|outcome|stage|status|priority|tier|role|direction|source|kind|category|level|channel|disposition|result)'))
), vals as (
  select cols.relname, cols.attname, x.v, x.n
    from cols,
    lateral (select (xpath('/row/v/text()', r))[1]::text as v, (xpath('/row/n/text()', r))[1]::text::bigint as n
               from unnest(xpath('/table/row', query_to_xml(
                      format('select %I::text as v, count(*) as n from %I.%I group by 1 order by 2 desc limit 80',
                             cols.attname, cols.nspname, cols.relname), true, false, ''))) r) x
)
select format('| %s.%s | %s | %s |', relname, attname, coalesce(replace(v, '|', '/'), '_(null)_'), n)
  from vals order by relname, attname, n desc, v;
select '';

-- ---------------------------------------------------------------------------
select '## 6. Triggers, RLS policies, functions, views';
select '';
select format('- trigger `%s` on `%s`: %s', t.tgname, c.relname, pg_get_triggerdef(t.oid))
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema' and not t.tgisinternal order by c.relname, t.tgname;
select format('- policy `%s` on `%s` (%s, roles %s): using %s; check %s', p.policyname, p.tablename, p.cmd, p.roles::text,
              coalesce(p.qual, '-'), coalesce(p.with_check, '-'))
  from pg_policies p where p.schemaname = :'schema' order by p.tablename, p.policyname;
select format('- function `%s(%s)` returns %s', p.proname, pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid))
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = :'schema' order by p.proname;
select format('- view `%s`', c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema' and c.relkind in ('v','m') order by c.relname;
select '';

-- ---------------------------------------------------------------------------
select '## 7. Assumption check — columns the migration mapping expects';
select '';
select 'From `migration/map/legacy_views.sql` (best guess from the Sep 13 app review). MISSING rows mean legacy_views.sql must be edited.';
select '';
select '| assumed table.column | status |';
select '|---|---|';
with assumed(t, col) as (values
  ('organizations','id'),('organizations','name'),
  ('profiles','id'),('profiles','org_id'),('profiles','email'),('profiles','full_name'),('profiles','role'),('profiles','points'),('profiles','created_at'),
  ('accounts','id'),('accounts','org_id'),('accounts','name'),('accounts','type'),('accounts','website'),('accounts','phone'),('accounts','address'),
  ('accounts','city'),('accounts','state'),('accounts','zip'),('accounts','priority'),('accounts','score'),('accounts','onboarding_status'),
  ('accounts','status'),('accounts','assigned_to'),('accounts','notes'),('accounts','created_by'),('accounts','created_at'),('accounts','updated_at'),
  ('contacts','id'),('contacts','org_id'),('contacts','account_id'),('contacts','first_name'),('contacts','last_name'),('contacts','title'),
  ('contacts','email'),('contacts','phone'),('contacts','mobile'),('contacts','notes'),('contacts','created_by'),('contacts','created_at'),('contacts','updated_at'),
  ('properties','id'),('properties','org_id'),('properties','account_id'),('properties','name'),('properties','address'),('properties','city'),
  ('properties','state'),('properties','zip'),('properties','property_type'),('properties','roof_type'),('properties','sqft'),('properties','buildings'),
  ('properties','notes'),('properties','created_by'),('properties','created_at'),('properties','updated_at'),
  ('property_contacts','property_id'),('property_contacts','contact_id'),('property_contacts','role'),
  ('opportunities','id'),('opportunities','org_id'),('opportunities','account_id'),('opportunities','property_id'),('opportunities','contact_id'),
  ('opportunities','name'),('opportunities','type'),('opportunities','stage'),('opportunities','value'),('opportunities','notes'),
  ('opportunities','assigned_to'),('opportunities','created_by'),('opportunities','stage_updated_at'),('opportunities','created_at'),('opportunities','updated_at'),
  ('touchpoints','id'),('touchpoints','org_id'),('touchpoints','account_id'),('touchpoints','contact_id'),('touchpoints','property_id'),
  ('touchpoints','opportunity_id'),('touchpoints','user_id'),('touchpoints','type'),('touchpoints','outcome'),('touchpoints','direction'),
  ('touchpoints','notes'),('touchpoints','source'),('touchpoints','gmail_message_id'),('touchpoints','gmail_thread_id'),('touchpoints','points'),
  ('touchpoints','created_at'),
  ('follow_ups','id'),('follow_ups','org_id'),('follow_ups','account_id'),('follow_ups','contact_id'),('follow_ups','property_id'),
  ('follow_ups','touchpoint_id'),('follow_ups','assigned_to'),('follow_ups','title'),('follow_ups','notes'),('follow_ups','due_date'),
  ('follow_ups','status'),('follow_ups','snooze_count'),('follow_ups','completed_at'),('follow_ups','created_at'),('follow_ups','updated_at')
)
select format('| %s.%s | %s |', a.t, a.col,
              case when exists (select 1 from information_schema.columns ic
                                 where ic.table_schema = :'schema' and ic.table_name = a.t and ic.column_name = a.col)
                   then 'ok' else '**MISSING**' end)
  from assumed a order by a.t, a.col;
select '';
select '| table present in schema but not assumed by the mapping | rows |';
select '|---|---:|';
select format('| %s | %s |', c.relname,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = :'schema' and c.relkind in ('r','p') and c.relname !~ '^_'
   and c.relname not in ('organizations','profiles','accounts','contacts','properties','property_contacts','opportunities','touchpoints','follow_ups')
 order by 1;
