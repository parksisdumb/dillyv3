-- 05_preflight.sql — stops the migration (RAISE) before any row is written when:
--   * the target tenant is missing, or legacy.* is empty
--   * a legacy enum-like value has no row in migration.value_map (the full list is printed, nothing is nulled)
--   * a value_map target is not a valid new code (e.g. a typo like 'voicemial')
--   * a canonical view has NULL or duplicate legacy ids (an upsert would silently collapse rows)
--   * a table in `legacy` is neither migrated nor explicitly marked legacy_only
do $$
declare
  problems text[] := '{}';
  r record;
  n bigint;
  ok boolean;
  lo int; hi int;
begin
  if migration.tenant_id() is null then
    problems := problems || format('tenant %s does not exist in public.tenant', coalesce(migration.cfg('tenant_slug'), 'fox'));
  end if;
  if not exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                  where s.nspname = 'legacy' and c.relkind = 'r' and c.relname !~ '^_') then
    problems := problems || 'schema legacy has no tables — run 03-restore-legacy.sh first'::text;
  end if;

  -- 1) unmapped values (all of them, with the column they come from and how many rows use them)
  for r in
    select u.domain, u.value, u.source_column, u.rows
      from legacy_v.value_usage u
     where not exists (select 1 from migration.value_map m where m.domain = u.domain and m.legacy_key = migration.vkey(u.value))
     order by u.domain, u.rows desc
  loop
    problems := problems || format('unmapped %s value %s (%s, %s rows)', r.domain,
                                   coalesce(quote_literal(r.value), '<null>'), r.source_column, r.rows);
  end loop;

  -- 2) map targets must be valid codes
  for r in select m.domain, m.legacy_value, m.new_value, d.target_type, d.allow_null
             from migration.value_map m join migration.value_domain d using (domain) loop
    if r.new_value is null then
      if not r.allow_null then
        problems := problems || format('value_map %s %L maps to NULL but the domain does not allow it', r.domain, r.legacy_value);
      end if;
      continue;
    end if;
    if r.target_type like 'one_of:%' then
      ok := r.new_value = any (string_to_array(substr(r.target_type, 8), ','));
    elsif r.target_type like 'int:%' then
      lo := split_part(substr(r.target_type, 5), '-', 1)::int; hi := split_part(substr(r.target_type, 5), '-', 2)::int;
      ok := r.new_value ~ '^\d+$' and r.new_value::int between lo and hi;
    else
      begin
        execute format('select %L::%s', r.new_value, r.target_type);
        ok := true;
      exception when others then ok := false;
      end;
    end if;
    if not ok then
      problems := problems || format('value_map %s %L -> %L is not a valid %s', r.domain, r.legacy_value, r.new_value, r.target_type);
    end if;
  end loop;

  -- 3) legacy ids: present and unique per canonical view (in scope)
  for r in select * from (values ('users'), ('accounts'), ('contacts'), ('properties'), ('opportunities'), ('touchpoints'), ('follow_ups')) v(name) loop
    execute format('select count(*) - count(distinct legacy_id) + count(*) filter (where legacy_id is null) from legacy_v.%I where migration.in_scope(org_id)', r.name) into n;
    if n > 0 then
      problems := problems || format('legacy_v.%s has %s null or duplicate legacy_id values', r.name, n);
    end if;
  end loop;
  select count(*) - count(distinct legacy_id) into n from legacy_v.property_contacts_in_scope;
  if n > 0 then
    problems := problems || format('legacy_v.property_contacts has %s duplicate (property, contact) pairs', n);
  end if;

  -- 4) every legacy table is classified
  for r in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'legacy' and c.relkind = 'r' and c.relname !~ '^_'
              and not exists (select 1 from migration.table_disposition d where d.legacy_table = c.relname)
            order by 1 loop
    problems := problems || format('legacy table %s has no disposition (add it to migration.table_disposition in legacy_views.sql)', r.relname);
  end loop;

  -- Non-blocking notes.
  select count(*) into n from legacy_v.users where migration.in_scope(org_id) and email is null;
  if n > 0 then raise notice 'preflight: % V2 users have no email; their rows migrate with null user columns and appear in migration.unmapped_actor', n; end if;

  if array_length(problems, 1) > 0 then
    raise exception E'migration preflight failed (% problems):\n  - %', array_length(problems, 1), array_to_string(problems, E'\n  - ')
      using hint = 'Fix migration/map/value_maps.sql or legacy_views.sql, then re-run. Nothing was written.';
  end if;
  insert into migration.run_log(step, detail) values ('preflight', jsonb_build_object('ok', true));
  raise notice 'preflight passed';
end $$;
