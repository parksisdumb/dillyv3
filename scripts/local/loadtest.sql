-- LOCAL LOAD TEST ONLY. Never run against a Supabase project.
--
-- Generates a realistic single-tenant book in the 'tsg' tenant and prints EXPLAIN ANALYZE timings
-- for the hot read paths (accounts list, account detail, rep_queue, cold list, leaderboard) as an
-- authenticated rep with RLS on.
--
--   DB=dilly_perf ./scripts/local/reset-db.sh
--   psql "postgresql://postgres@localhost:54329/dilly_perf?host=/tmp" -f scripts/local/loadtest.sql
--
-- Volume: 12 reps, 2,000 accounts, 10,000 contacts, 8,000 properties, 1,500 opportunities,
--         50,000 touches, 5,000 tasks, ~60,000 point events.
\set ON_ERROR_STOP 1
\timing off
set client_min_messages = warning;

-- ---------------------------------------------------------------------------------------------
-- Data (as superuser; triggers on so profiles get created, then off for bulk rows)
-- ---------------------------------------------------------------------------------------------
do $$
declare t uuid := (select id from public.tenant where slug = 'tsg');
begin
  if exists (select 1 from public.account where tenant_id = t and legacy_table = 'loadtest') then
    raise notice 'loadtest data already present';
    return;
  end if;
  insert into auth.users(email)
    select format('loadrep%s@example.test', g) from generate_series(1, 12) g;
  insert into public.membership(tenant_id, user_id, role)
    select t, u.id, case when u.email = 'loadrep1@example.test' then 'manager' else 'rep' end
      from auth.users u where u.email like 'loadrep%@example.test'
  on conflict do nothing;
end $$;

create temp table reps as
  select row_number() over (order by u.email) as n, u.id
    from auth.users u where u.email like 'loadrep%@example.test';

set session_replication_role = replica;  -- skip touch/task triggers for bulk history; stamps are set below

do $$
declare t uuid := (select id from public.tenant where slug = 'tsg');
        nreps int := (select count(*) from reps);
begin
  if exists (select 1 from public.account where tenant_id = t and legacy_table = 'loadtest') then return; end if;

  insert into public.account(tenant_id, name, account_type, city, state, icp_tier, score, owner_user_id, legacy_table, legacy_id, phone)
  select t,
         'Load Account ' || g,
         (array['owner','property_mgmt','facilities','reit','gc','developer','government','education','healthcare','industrial'])[1 + g % 10],
         (array['Memphis','Nashville','Germantown','Collierville','Bartlett','Southaven','Olive Branch','Jackson'])[1 + g % 8],
         'TN',
         (1 + g % 4)::smallint,
         (g % 17)::numeric,
         case when g % 10 = 0 then null else (select id from reps where n = 1 + g % nreps) end,
         'loadtest', g::text, '901-555-' || lpad((g % 10000)::text, 4, '0')
    from generate_series(1, 2000) g;

  create temp table accts as
    select row_number() over (order by a.legacy_id::int) as n, a.id, a.owner_user_id
      from public.account a where a.tenant_id = t and a.legacy_table = 'loadtest';

  insert into public.contact(tenant_id, account_id, first_name, last_name, title, email, phone, legacy_table, legacy_id)
  select t, (select id from accts where n = 1 + g % 2000),
         'First' || g, 'Last' || g, 'Facilities Manager',
         format('c%s@example.test', g), '901-444-' || lpad((g % 10000)::text, 4, '0'),
         'loadtest', g::text
    from generate_series(1, 10000) g;

  insert into public.property(tenant_id, account_id, name, address1, city, state, roof_system, roof_area_sf, roof_install_year, legacy_table, legacy_id)
  select t, case when g % 20 = 0 then null else (select id from accts where n = 1 + g % 2000) end,
         'Building ' || g, (100 + g) || ' Poplar Ave',
         (array['Memphis','Nashville','Germantown','Collierville','Bartlett','Southaven','Olive Branch','Jackson'])[1 + g % 8],
         'TN', (array['TPO','EPDM','PVC','mod_bit','BUR','metal'])[1 + g % 6], 10000 + (g % 90) * 1000, (1990 + g % 34)::smallint,
         'loadtest', g::text
    from generate_series(1, 8000) g;

  insert into public.opportunity(tenant_id, account_id, name, stage, value_estimate, owner_user_id, legacy_table, legacy_id)
  select t, a.id, 'Opp ' || g,
         (array['lead','contacted','inspection_scheduled','inspection_complete','proposal_sent','negotiation','won','lost'])[1 + g % 8],
         5000 + (g % 50) * 2500, a.owner_user_id, 'loadtest', g::text
    from generate_series(1, 1500) g join accts a on a.n = 1 + (g * 7) % 2000;

  -- 50,000 touches over the last 400 days, spread across reps and accounts (~1,700 accounts touched).
  insert into public.touch(tenant_id, occurred_at, user_id, account_id, contact_id, channel, outcome, source, legacy_table, legacy_id)
  select t, now() - ((g % 400) || ' days')::interval - ((g % 600) || ' minutes')::interval,
         (select id from reps where n = 1 + g % nreps),
         a.id, null,
         (array['call','email','door_knock','site_visit','text'])[1 + g % 5],
         (array['connected','voicemail','no_answer','sent','met_in_person'])[1 + g % 5],
         'rep', 'loadtest', g::text
    from generate_series(1, 50000) g join accts a on a.n = 1 + (g * 13) % 1700;

  insert into public.task(tenant_id, assignee_user_id, account_id, kind, title, reason, due_on, status, priority, legacy_table, legacy_id)
  select t, coalesce(a.owner_user_id, (select id from reps where n = 1)), a.id, 'follow_up', 'Follow up ' || g, 'load',
         current_date - 30 + (g % 45), case when g % 3 = 0 then 'done' else 'open' end, 50,
         'loadtest', g::text
    from generate_series(1, 5000) g join accts a on a.n = 1 + (g * 11) % 2000;

  insert into public.point_event(tenant_id, user_id, event, points, occurred_at)
  select t, (select id from reps where n = 1 + g % nreps), 'touch_logged', 1, now() - ((g % 400) || ' days')::interval
    from generate_series(1, 60000) g;

  update public.account a set last_touch_at = x.mx, first_touch_at = x.mn
    from (select account_id, max(occurred_at) mx, min(occurred_at) mn from public.touch where tenant_id = t group by 1) x
   where a.id = x.account_id;

  insert into public.account_preference(tenant_id, account_id, preference, reason)
  select t, id, (array['pursue','deprioritize','do_not_pursue','existing_client'])[1 + n % 4], 'load'
    from accts where n % 25 = 0;
  insert into public.tenant_targeting(tenant_id, dimension, value, mode, weight)
  values (t, 'account_type', 'reit', 'include', 1.3), (t, 'account_type', 'government', 'exclude', 1.0)
  on conflict do nothing;
end $$;

set session_replication_role = origin;
analyze;

-- ---------------------------------------------------------------------------------------------
-- Timings as an authenticated rep (RLS on). Each query runs 3× and the last is reported (warm cache).
-- ---------------------------------------------------------------------------------------------
select id as rep from reps where n = 2 \gset
select id as tsg from public.tenant where slug = 'tsg' \gset
select set_config('request.jwt.claim.sub', :'rep', false);
set role authenticated;

create or replace function pg_temp.time_ms(q text) returns numeric language plpgsql as $$
declare plan json; i int;
begin
  for i in 1..3 loop
    execute 'explain (analyze, format json) ' || q into plan;
  end loop;
  return round((plan->0->>'Execution Time')::numeric, 1);
end $$;

select label, pg_temp.time_ms(q) as ms from (values
  ('accounts list — mine (rank order)',
   format($q$select id,name,account_type,icp_tier,relationship_state,last_touch_at,days_since_touch,property_count,contact_count,open_opps,excluded_reason,preference,city,rank_score
              from public.account_ranked where tenant_id = %L and is_test = false and owner_user_id = %L
             order by rank_score desc nulls last, name limit 150$q$, :'tsg', :'rep')),
  ('accounts list — all (rank order)',
   format($q$select id,name,account_type,icp_tier,relationship_state,last_touch_at,days_since_touch,property_count,contact_count,open_opps,excluded_reason,preference,city,rank_score
              from public.account_ranked where tenant_id = %L and is_test = false
             order by rank_score desc nulls last, name limit 150$q$, :'tsg')),
  ('accounts list — all, search "load account 1"',
   format($q$select id,name,rank_score from public.account_ranked where tenant_id = %L and is_test = false
               and normalized_name ilike '%%load account 1%%' order by rank_score desc nulls last, name limit 150$q$, :'tsg')),
  ('account detail (account_ranked by id)',
   format($q$select * from public.account_ranked where tenant_id = %L and id = (select id from public.account where tenant_id = %L and legacy_id = '42' and legacy_table = 'loadtest')$q$, :'tsg', :'tsg')),
  ('rep_queue',
   format($q$select * from public.rep_queue(%L, %L)$q$, :'tsg', :'rep')),
  ('team cold list (P1/P2 cold)',
   format($q$select id,name,icp_tier,days_since_touch from public.account_ranked where tenant_id = %L and relationship_state = 'cold'
               and icp_tier <= 2 and is_test = false order by icp_tier, days_since_touch desc limit 50$q$, :'tsg')),
  ('leaderboard (week)',
   format($q$select * from public.leaderboard(%L, current_date - 7)$q$, :'tsg')),
  ('touch timeline (tenant, recent 40)',
   format($q$select id from public.touch where tenant_id = %L order by occurred_at desc limit 40$q$, :'tsg')),
  ('properties list — city filter',
   format($q$select id,name from public.property where tenant_id = %L and duplicate_of is null and is_test = false and city ilike 'Memphis' order by name limit 500$q$, :'tsg')),
  ('properties search (address ilike)',
   format($q$select id from public.property where tenant_id = %L and (name ilike '%%1234%%' or address1 ilike '%%1234%%') limit 500$q$, :'tsg'))
) v(label, q);

reset role;
