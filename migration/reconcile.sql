-- reconcile.sql — defines migration.reconcile() and prints its report. Read-only apart from (re)creating the function.
-- Every check returns PASS / FAIL / WARN / INFO. Any FAIL blocks cutover (04-reconcile.sh exits non-zero).
-- Nothing is excluded from the counts: test rows, duplicates, orphans and unmapped actors are all counted.

create or replace function migration.reconcile()
returns table (seq int, check_name text, entity text, expected text, actual text, status text, detail text)
language plpgsql as $fn$
#variable_conflict use_column
declare
  t uuid := migration.tenant_id();
  e record; r record;
  n_legacy bigint; n_new bigint; n_missing bigint; n_extra bigint; n bigint; m bigint;
  s_legacy numeric; s_new numeric;
  sample text;
  i int := 0;
begin
  if t is null then
    seq := 0; check_name := 'tenant'; entity := coalesce(migration.cfg('tenant_slug'), 'fox'); expected := 'exists'; actual := 'missing';
    status := 'FAIL'; detail := 'target tenant not found'; return next; return;
  end if;

  -- 0. every restored legacy table is classified (nothing silently ignored)
  for r in select c.relname, d.disposition, d.note
             from pg_class c join pg_namespace s on s.oid = c.relnamespace
             left join migration.table_disposition d on d.legacy_table = c.relname
            where s.nspname = 'legacy' and c.relkind = 'r' and c.relname !~ '^_' order by 1 loop
    i := i + 1; seq := i; check_name := 'table_disposition'; entity := r.relname; expected := 'classified';
    actual := coalesce(r.disposition, 'unclassified');
    status := case when r.disposition is null then 'FAIL' when r.disposition = 'legacy_only' then 'INFO' else 'PASS' end;
    detail := coalesce(r.note, 'add to migration.table_disposition'); return next;
  end loop;

  -- 0b. the raw copy is intact (rows never disappear from legacy.*)
  if to_regclass('legacy._row_counts') is not null then
    for r in select rc.table_name, rc.restored_count,
                    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from legacy.%I', rc.table_name), false, true, '')))[1]::text::bigint as now_count
               from legacy._row_counts rc where to_regclass(format('legacy.%I', rc.table_name)) is not null order by 1 loop
      i := i + 1; seq := i; check_name := 'legacy_copy_intact'; entity := r.table_name;
      expected := '>= ' || r.restored_count; actual := r.now_count::text;
      status := case when r.now_count < r.restored_count then 'FAIL' else 'PASS' end;
      detail := case when r.now_count > r.restored_count then (r.now_count - r.restored_count) || ' rows added by delta' end; return next;
    end loop;
  end if;

  -- 1. per entity: counts, every legacy id present, no unexpected extras
  for e in select * from (values ('accounts','account',1), ('contacts','contact',2), ('properties','property',3),
                                 ('opportunities','opportunity',4), ('touchpoints','touch',5), ('follow_ups','task',6)) v(canon, tgt, ord) order by ord loop
    execute format('select count(*) from legacy_v.%I where migration.in_scope(org_id)', e.canon) into n_legacy;
    execute format('select count(*) from public.%I where tenant_id = $1 and legacy_table = $2', e.tgt) using t, migration.lt(e.canon) into n_new;
    execute format($q$select count(*), string_agg(legacy_id, ', ' order by legacy_id) filter (where rn <= 5)
                        from (select v.legacy_id, row_number() over (order by v.legacy_id) rn from legacy_v.%I v
                               where migration.in_scope(v.org_id)
                                 and not exists (select 1 from public.%I x where x.tenant_id = $1 and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id)) q$q$,
                   e.canon, e.tgt) using t into n_missing, sample;
    execute format($q$select count(*) from public.%I x where x.tenant_id = $1 and x.legacy_table = $2
                        and not exists (select 1 from legacy_v.%I v where v.legacy_id = x.legacy_id and migration.in_scope(v.org_id))$q$,
                   e.tgt, e.canon) using t, migration.lt(e.canon) into n_extra;
    i := i + 1; seq := i; check_name := 'row_count'; entity := e.canon || ' -> ' || e.tgt;
    expected := n_legacy::text; actual := n_new::text; status := case when n_legacy = n_new then 'PASS' else 'FAIL' end;
    detail := null; return next;
    i := i + 1; seq := i; check_name := 'every_legacy_id_present'; expected := '0 missing'; actual := n_missing || ' missing';
    status := case when n_missing = 0 then 'PASS' else 'FAIL' end; detail := sample; return next;
    i := i + 1; seq := i; check_name := 'no_rows_without_legacy_source'; expected := '0 extra'; actual := n_extra || ' extra';
    status := case when n_extra = 0 then 'PASS' else 'WARN' end;
    detail := case when n_extra > 0 then 'migrated rows whose V2 row no longer exists (deleted in V2 after load?)' end; return next;
  end loop;

  -- 1b. users
  select count(*) into n_legacy from legacy_v.users where migration.in_scope(org_id);
  select count(*), count(*) filter (where profile_id is null and invite_id is null), count(*) filter (where profile_id is not null)
    into n_new, n_missing, n from migration.user_map where tenant_id = t;
  i := i + 1; seq := i; check_name := 'row_count'; entity := 'users -> user_map'; expected := n_legacy::text; actual := n_new::text;
  status := case when n_legacy = n_new then 'PASS' else 'FAIL' end; detail := n || ' signed in (profile), ' || (n_new - n) || ' invited'; return next;
  i := i + 1; seq := i; check_name := 'users_have_profile_or_invite'; expected := '0'; actual := n_missing::text;
  status := case when n_missing = 0 then 'PASS' else 'FAIL' end;
  select string_agg(coalesce(email, legacy_user_id), ', ') into detail from migration.user_map where tenant_id = t and profile_id is null and invite_id is null;
  return next;

  -- 1c. property <-> contact links
  select count(*),
         count(*) filter (where p.id is not null and c.id is not null),
         count(*) filter (where p.id is not null and c.id is not null and pc2.property_id is null)
    into n_legacy, n, n_missing
    from legacy_v.property_contacts_in_scope pc
    left join public.property p on p.tenant_id = t and p.legacy_table = migration.lt('properties') and p.legacy_id = pc.property_legacy_id
    left join public.contact  c on c.tenant_id = t and c.legacy_table = migration.lt('contacts')  and c.legacy_id = pc.contact_legacy_id
    left join public.property_contact pc2 on pc2.property_id = p.id and pc2.contact_id = c.id;
  i := i + 1; seq := i; check_name := 'row_count'; entity := 'property_contacts -> property_contact';
  expected := n_legacy::text; actual := (n - n_missing)::text || ' linked + ' || (n_legacy - n)::text || ' orphan links flagged';
  status := case when n_missing = 0 then 'PASS' else 'FAIL' end;
  detail := case when n_missing > 0 then n_missing || ' links missing although both ends migrated' end; return next;

  -- 2. opportunity value totals
  select coalesce(sum(value), 0) into s_legacy from legacy_v.opportunities where migration.in_scope(org_id);
  select coalesce(sum(value_estimate), 0) into s_new from public.opportunity where tenant_id = t and legacy_table = migration.lt('opportunities');
  i := i + 1; seq := i; check_name := 'opportunity_value_total'; entity := 'opportunities';
  expected := to_char(s_legacy, 'FM999,999,999,990.00'); actual := to_char(s_new, 'FM999,999,999,990.00');
  status := case when s_legacy = s_new then 'PASS' else 'FAIL' end; detail := null; return next;
  for r in
    with l as (select migration.map('opp_stage', stage) as k, count(*) n, sum(value) v from legacy_v.opportunities where migration.in_scope(org_id) group by 1),
         x as (select stage::text as k, count(*) n, sum(value_estimate) v from public.opportunity where tenant_id = t and legacy_table = migration.lt('opportunities') group by 1)
    select coalesce(l.k, x.k) k, l.n ln, x.n xn, l.v lv, x.v xv from l full join x on l.k = x.k order by 1
  loop
    i := i + 1; seq := i; check_name := 'opportunities_per_stage'; entity := r.k;
    expected := coalesce(r.ln, 0) || ' / $' || coalesce(r.lv, 0); actual := coalesce(r.xn, 0) || ' / $' || coalesce(r.xv, 0);
    status := case when r.ln is not distinct from r.xn and r.lv is not distinct from r.xv then 'PASS' else 'FAIL' end; detail := null; return next;
  end loop;

  -- 3. touches per rep per ISO week (UTC weeks on both sides; catches attribution and timestamp shifts)
  with l as (
    select coalesce(actor_legacy_user_id, '<none>') u, to_char(occurred_at at time zone 'UTC', 'IYYY-"W"IW') w, count(*) n
      from legacy_v.touchpoints where migration.in_scope(org_id) group by 1, 2
  ), x as (
    select coalesce(um.legacy_user_id, ua.legacy_user_id, '<none>') u, to_char(tc.occurred_at at time zone 'UTC', 'IYYY-"W"IW') w, count(*) n
      from public.touch tc
      left join lateral (select legacy_user_id from migration.user_map where tenant_id = t and profile_id = tc.user_id
                          order by legacy_user_id limit 1) um on tc.user_id is not null
      left join migration.unmapped_actor ua on tc.user_id is null and ua.tenant_id = t and ua.legacy_table = tc.legacy_table
            and ua.legacy_id = tc.legacy_id and ua.role_column = 'actor'
     where tc.tenant_id = t and tc.legacy_table = migration.lt('touchpoints')
     group by 1, 2
  )
  select count(*) filter (where l.n is distinct from x.n), count(*),
         string_agg(coalesce(l.u, x.u) || ' ' || coalesce(l.w, x.w) || ': ' || coalesce(l.n, 0) || ' vs ' || coalesce(x.n, 0), '; ')
           filter (where l.n is distinct from x.n)
    into n, m, sample
    from l full join x on l.u = x.u and l.w = x.w;
  i := i + 1; seq := i; check_name := 'touches_per_rep_per_week'; entity := 'touchpoints';
  expected := '0 mismatched rep-weeks'; actual := n || ' of ' || m || ' rep-weeks differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := left(sample, 500); return next;

  -- 4/5. contacts per account, properties per account
  -- Properties whose management was changed in the new app (30_properties.sql keeps the app's account) are left out
  -- on both sides: there V2 is no longer the source of truth for the link.
  for e in select * from (values
      ('contacts','contact', '', ''),
      ('properties','property',
       $f$and not exists (select 1 from public.property p join public.property_party pp on pp.property_id = p.id
                            where p.tenant_id = $1 and p.legacy_table = $2 and p.legacy_id = v.legacy_id
                              and (pp.source in ('rep','transfer','agent') or (pp.source = 'direct_edit' and pp.created_by is not null)))$f$,
       $f$and not exists (select 1 from public.property_party pp where pp.property_id = c.id
                              and (pp.source in ('rep','transfer','agent') or (pp.source = 'direct_edit' and pp.created_by is not null)))$f$)
    ) v(canon, tgt, lskip, xskip) loop
    execute format($q$
      with l as (select v.account_legacy_id a, count(*) n from legacy_v.%1$I v
                  where migration.in_scope(v.org_id) and v.account_legacy_id is not null
                    and exists (select 1 from legacy_v.accounts la where la.legacy_id = v.account_legacy_id and migration.in_scope(la.org_id))
                    %3$s
                  group by 1),
           x as (select a.legacy_id a, count(*) n from public.%2$I c join public.account a on a.id = c.account_id
                  where c.tenant_id = $1 and c.legacy_table = $2 and a.legacy_table = $3 %4$s group by 1)
      select count(*) filter (where l.n is distinct from x.n), count(*),
             string_agg(coalesce(l.a, x.a) || ': ' || coalesce(l.n, 0) || ' vs ' || coalesce(x.n, 0), '; ') filter (where l.n is distinct from x.n)
        from l full join x on l.a = x.a$q$, e.canon, e.tgt, e.lskip, e.xskip)
      using t, migration.lt(e.canon), migration.lt('accounts') into n, m, sample;
    i := i + 1; seq := i; check_name := e.canon || '_per_account'; entity := 'accounts';
    expected := '0 accounts differ'; actual := n || ' of ' || m || ' accounts differ';
    status := case when n = 0 then 'PASS' else 'FAIL' end; detail := left(sample, 500); return next;
  end loop;
  select count(*) into n from migration.flagged_row where tenant_id = t and flag = 'orphan';
  i := i + 1; seq := i; check_name := 'orphans_migrated_unlinked'; entity := 'all'; expected := 'counted'; actual := n::text;
  status := 'INFO'; detail := 'rows whose V2 parent no longer exists; migrated with the link empty (migration.flagged_row)'; return next;

  -- 6. notes length (no truncation, no lost notes)
  for r in
    select 'accounts.notes' k, count(*) filter (where length(v.notes) is distinct from length(x.notes)) bad,
           coalesce(sum(length(v.notes)), 0) lsum, coalesce(sum(length(x.notes)), 0) xsum
      from legacy_v.accounts v join public.account x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
    union all
    select 'contacts.notes', count(*) filter (where length(v.notes) is distinct from length(x.notes)), coalesce(sum(length(v.notes)), 0), coalesce(sum(length(x.notes)), 0)
      from legacy_v.contacts v join public.contact x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
    union all
    select 'properties.notes', count(*) filter (where length(v.notes) is distinct from length(x.notes)), coalesce(sum(length(v.notes)), 0), coalesce(sum(length(x.notes)), 0)
      from legacy_v.properties v join public.property x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
    union all
    select 'touchpoints.notes', count(*) filter (where length(v.notes) is distinct from length(x.notes)), coalesce(sum(length(v.notes)), 0), coalesce(sum(length(x.notes)), 0)
      from legacy_v.touchpoints v join public.touch x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
    union all
    select 'follow_ups.notes -> task.reason', count(*) filter (where v.notes is not null and length(v.notes) <> length(x.reason)),
           coalesce(sum(length(v.notes)), 0), coalesce(sum(length(x.reason)) filter (where v.notes is not null), 0)
      from legacy_v.follow_ups v join public.task x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
    union all
    select 'opportunities.notes -> legacy_value', count(*) filter (where length(v.notes) is distinct from length(lv.value)),
           coalesce(sum(length(v.notes)), 0), coalesce(sum(length(lv.value)), 0)
      from legacy_v.opportunities v
      left join migration.legacy_value lv on lv.tenant_id = t and lv.legacy_table = v.legacy_table and lv.legacy_id = v.legacy_id and lv.field = 'notes'
     where migration.in_scope(v.org_id)
  loop
    i := i + 1; seq := i; check_name := 'notes_length'; entity := r.k;
    expected := r.lsum || ' chars'; actual := r.xsum || ' chars, ' || r.bad || ' rows differ';
    status := case when r.bad = 0 and r.lsum = r.xsum then 'PASS' else 'FAIL' end; detail := null; return next;
  end loop;

  -- 7. touch ledger fidelity: channel / outcome / direction / time / rep match the mapped V2 row
  select count(*),
         string_agg(v.legacy_id, ', ') filter (where true)
    into n, sample
    from legacy_v.touchpoints v
    join public.touch x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
   where migration.in_scope(v.org_id)
     and (x.channel::text <> migration.map('touch_type', v.touch_type)
       or x.outcome::text <> migration.map('touch_outcome', v.outcome)
       or x.direction <> migration.map('touch_direction', v.direction)
       or x.occurred_at <> coalesce(v.occurred_at, v.created_at)
       or x.user_id is distinct from migration.uid(v.actor_legacy_user_id) and x.user_id is not null);
  i := i + 1; seq := i; check_name := 'touch_fields_match'; entity := 'touchpoints'; expected := '0 rows differ'; actual := n || ' rows differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := case when n > 0 then 'V2 changed these after the first load; void + re-log in the app: ' || left(sample, 400) end; return next;

  select count(*) into n
    from legacy_v.follow_ups v join public.task x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
   where x.created_at <> coalesce(v.created_at, x.created_at) or x.due_on <> coalesce(v.due_on, x.due_on);
  i := i + 1; seq := i; check_name := 'task_dates_match'; entity := 'follow_ups'; expected := '0 rows differ'; actual := n || ' rows differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := 'created_at + due date preserved (auto-close depends on them)'; return next;

  -- 8. timezone spot check: 10 touches side by side (stored UTC; shown in tenant time)
  for r in
    select v.legacy_id, coalesce(v.occurred_at, v.created_at) as l_ts, x.occurred_at as x_ts,
           (select timezone from public.tenant where id = t) as tz
      from legacy_v.touchpoints v
      join public.touch x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
     where migration.in_scope(v.org_id)
     order by md5(v.legacy_id) limit 10
  loop
    i := i + 1; seq := i; check_name := 'timestamp_sample'; entity := 'touch ' || r.legacy_id;
    expected := to_char(r.l_ts at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC';
    actual := to_char(r.x_ts at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS') || ' UTC';
    status := case when r.l_ts = r.x_ts then 'PASS' else 'FAIL' end;
    detail := 'shows as ' || to_char(r.x_ts at time zone r.tz, 'Mon DD HH12:MI AM') || ' ' || r.tz; return next;
  end loop;

  -- 9. ICP tiers, onboarding ladder, preferences
  for r in
    with l as (select migration.map('icp_priority', priority) k, count(*) n from legacy_v.accounts where migration.in_scope(org_id) group by 1),
         x as (select icp_tier::text k, count(*) n from public.account where tenant_id = t and legacy_table = migration.lt('accounts') group by 1)
    select 'P' || coalesce(l.k, x.k) k, l.n ln, x.n xn from l full join x on l.k = x.k
    union all
    select * from (
      with l as (select migration.map('onboarding_status', onboarding_status) k, count(*) n from legacy_v.accounts where migration.in_scope(org_id) group by 1),
           x as (select onboarding_status::text k, count(*) n from public.account where tenant_id = t and legacy_table = migration.lt('accounts') group by 1)
      select 'onboarding ' || coalesce(l.k, x.k), l.n, x.n from l full join x on l.k = x.k) o
    union all
    select * from (
      with l as (select migration.map('account_status', status) k, count(*) n from legacy_v.accounts where migration.in_scope(org_id)
                  and migration.map('account_status', status) is not null group by 1),
           x as (select p.preference::text k, count(*) n from public.account_preference p join public.account a on a.id = p.account_id
                  where p.tenant_id = t and a.legacy_table = migration.lt('accounts') and p.reason like 'Dilly V2 status:%' group by 1)
      select 'preference ' || coalesce(l.k, x.k), l.n, x.n from l full join x on l.k = x.k) p
    order by 1
  loop
    i := i + 1; seq := i; check_name := 'distribution'; entity := r.k; expected := coalesce(r.ln, 0)::text; actual := coalesce(r.xn, 0)::text;
    status := case when r.ln is not distinct from r.xn then 'PASS' else 'FAIL' end; detail := null; return next;
  end loop;

  -- 10. follow-ups: every open task with a later touch is closed
  select count(*) into n from public.task k
   where k.tenant_id = t and k.status = 'open'
     and exists (select 1 from public.touch x where x.tenant_id = t and x.voided_at is null and x.occurred_at >= k.created_at
                   and ((k.contact_id is not null and x.contact_id = k.contact_id) or (k.contact_id is null and x.account_id = k.account_id)));
  i := i + 1; seq := i; check_name := 'open_tasks_with_later_touch'; entity := 'tasks'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := 'app.reconcile_tasks must have run'; return next;
  select count(*) filter (where k.status = 'open'), count(*) filter (where k.status = 'done' and k.completed_by_touch_id is not null and v.status is not null
                                                                    and migration.map('task_status', v.status) = 'open')
    into n, m
    from public.task k left join legacy_v.follow_ups v on v.legacy_id = k.legacy_id
   where k.tenant_id = t and k.legacy_table = migration.lt('follow_ups');
  i := i + 1; seq := i; check_name := 'follow_ups_auto_closed'; entity := 'tasks'; expected := 'info';
  actual := m || ' V2-open follow-ups closed by a later touch; ' || n || ' still open';
  status := 'INFO'; detail := null; return next;

  -- 11. provenance: no dillyv2 row without a legacy id, anywhere
  select (select count(*) from public.account where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.contact where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.property where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.opportunity where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.touch where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.task where source = 'dillyv2' and legacy_id is null)
    into n;
  i := i + 1; seq := i; check_name := 'dillyv2_rows_have_legacy_id'; entity := 'all'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := null; return next;

  -- 12. legacy values kept (points totals)
  select coalesce(sum(nullif(legacy_points, '')::numeric), 0) into s_legacy from legacy_v.users where migration.in_scope(org_id);
  select coalesce(sum(value::numeric), 0) into s_new from migration.legacy_value where tenant_id = t and legacy_table = migration.lt('users') and field = 'legacy_points';
  i := i + 1; seq := i; check_name := 'legacy_points_kept'; entity := 'users'; expected := s_legacy::text; actual := s_new::text;
  status := case when s_legacy = s_new then 'PASS' else 'FAIL' end; detail := 'not migrated as points; kept for comparison with v2 scoring'; return next;

  -- 13. unmapped actors (nothing dropped; user columns empty until the person signs in)
  select count(*), count(distinct legacy_user_id), string_agg(distinct coalesce(legacy_email, legacy_user_id), ', ')
    into n, m, sample from migration.unmapped_actor where tenant_id = t and resolved_profile_id is null;
  i := i + 1; seq := i; check_name := 'unmapped_actors'; entity := 'users'; expected := '0'; actual := n || ' rows / ' || m || ' people';
  status := case when n = 0 then 'PASS' else 'WARN' end;
  detail := case when n > 0 then 'have them sign in, then re-run 03b-transform.sh --reattribute: ' || sample end; return next;
  select count(*) into n from migration.unmapped_actor a join public.touch x on x.tenant_id = a.tenant_id and x.legacy_table = a.legacy_table
     and x.legacy_id = a.legacy_id where a.tenant_id = t and a.role_column = 'actor' and a.resolved_profile_id is not null and x.user_id is null;
  i := i + 1; seq := i; check_name := 'touches_awaiting_reattribute'; entity := 'touch'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'WARN' end; detail := case when n > 0 then 'run 03b-transform.sh --reattribute' end; return next;

  -- 14. flags and duplicate suggestions (informational: nothing dropped, nothing merged)
  for r in select flag, count(*) n from migration.flagged_row where tenant_id = t group by 1 order by 1 loop
    i := i + 1; seq := i; check_name := 'flagged_rows'; entity := r.flag; expected := 'review'; actual := r.n::text; status := 'INFO';
    detail := 'migration.flagged_row'; return next;
  end loop;
  for r in select d.entity as ent, count(*) n from migration.duplicate_suggestion d where d.tenant_id = t group by 1 order by 1 loop
    i := i + 1; seq := i; check_name := 'duplicate_suggestions'; entity := r.ent; expected := 'review'; actual := r.n::text; status := 'INFO';
    detail := 'not merged; migration.duplicate_suggestion'; return next;
  end loop;
end $fn$;

\pset footer off
select * from migration.reconcile() order by seq;
