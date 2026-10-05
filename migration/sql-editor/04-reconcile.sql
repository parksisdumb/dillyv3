-- =====================================================================================================================
-- 04-reconcile.sql — run in the NEW Dilly project after 03-transform.sql. Read-only (apart from (re)creating the
-- function migration.reconcile()). Safe to re-run any time.
--
-- One result table. The FIRST row is the verdict:  PASS = OK to cut over,  FAIL = do NOT cut over.
-- Every check is PASS / FAIL / WARN / INFO. Nothing is excluded from the counts: test rows, duplicates, orphans and
-- unmapped people are all counted. Soft-deleted V2 rows are expected to stay in legacy only (INFO).
-- =====================================================================================================================

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
  if t is null or migration.fox_org() is null then
    seq := 1; check_name := 'setup'; entity := 'tenant / FOX org'; expected := 'set'; actual := 'missing';
    status := 'FAIL'; detail := 'run 02-preflight.sql and 03-transform.sql first'; return next; return;
  end if;

  create temp table if not exists _app_owned_rc (property_id uuid primary key) on commit drop;
  truncate _app_owned_rc;
  insert into _app_owned_rc
  select distinct pp.property_id from public.property_party pp join public.property p on p.id = pp.property_id
   where p.tenant_id = t and (pp.source in ('rep', 'transfer', 'agent') or (pp.source = 'direct_edit' and pp.created_by is not null));

  -- 0. every copied table is classified; the raw copy is intact; no other org leaked in
  for r in select c.relname, d.disposition, d.note
             from pg_class c join pg_namespace s on s.oid = c.relnamespace
             left join migration.table_disposition d on d.legacy_table = c.relname
            where s.nspname = 'legacy' and c.relkind = 'r' and c.relname !~ '^_' order by 1 loop
    i := i + 1; seq := i; check_name := 'table_disposition'; entity := r.relname; expected := 'classified';
    actual := coalesce(r.disposition, 'unclassified');
    status := case when r.disposition is null then 'FAIL' when r.disposition = 'legacy_only' then 'INFO' else 'PASS' end;
    detail := coalesce(r.note, 'add to migration.table_disposition in 02-preflight.sql'); return next;
  end loop;

  for r in select st.table_name, st.source_rows,
                  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from legacy.%I', st.table_name), false, true, '')))[1]::text::bigint as now_count
             from migration.snapshot_table st
            where st.snapshot_id = (select max(id) from migration.snapshot where kind = 'full' and finished_at is not null)
              and to_regclass(format('legacy.%I', st.table_name)) is not null
            order by 1 loop
    i := i + 1; seq := i; check_name := 'legacy_copy_intact'; entity := r.table_name;
    expected := '>= ' || r.source_rows; actual := r.now_count::text;
    status := case when r.now_count < r.source_rows then 'FAIL' else 'PASS' end;
    detail := case when r.now_count > r.source_rows then (r.now_count - r.source_rows) || ' rows added by 06-delta' end; return next;
  end loop;

  select (select count(*) from public.account x join legacy.accounts l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'accounts' and not migration.in_scope(l.org_id))
       + (select count(*) from public.contact x join legacy.contacts l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'contacts' and not migration.in_scope(l.org_id))
       + (select count(*) from public.property x join legacy.properties l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'properties' and not migration.in_scope(l.org_id))
       + (select count(*) from public.opportunity x join legacy.opportunities l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'opportunities' and not migration.in_scope(l.org_id))
       + (select count(*) from public.touch x join legacy.touchpoints l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'touchpoints' and not migration.in_scope(l.org_id))
       + (select count(*) from public.touch x join legacy.synced_emails l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'synced_emails' and not migration.in_scope(l.org_id))
       + (select count(*) from public.task x join legacy.next_actions l on l.id::text = x.legacy_id
           where x.tenant_id = t and x.legacy_table = 'next_actions' and not migration.in_scope(l.org_id))
       + (select count(*) from migration.user_map um
           where um.tenant_id = t
             and not exists (select 1 from legacy.org_users f where f.user_id::text = um.legacy_user_id and migration.in_scope(f.org_id))
             and not exists (select 1 from legacy.memberships f where f.user_id::text = um.legacy_user_id and migration.in_scope(f.org_id)))
    into n;
  i := i + 1; seq := i; check_name := 'other_v2_orgs_not_migrated'; entity := 'all'; expected := '0 rows'; actual := n || ' rows';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := (select count(*) || ' other orgs stay in legacy only' from legacy.orgs where id <> migration.fox_org()); return next;

  -- 1. per entity: counts, every legacy id present, no unexpected extras
  for e in select * from (values
      ('accounts',      'account',     array['accounts'],                     'v.deleted_at is null', 1),
      ('contacts',      'contact',     array['contacts'],                     'v.deleted_at is null', 2),
      ('properties',    'property',    array['properties'],                   'v.deleted_at is null', 3),
      ('opportunities', 'opportunity', array['opportunities'],                'v.deleted_at is null', 4),
      ('touches',       'touch',       array['touchpoints','synced_emails'],  'true',                 5),
      ('follow_ups',    'task',        array['next_actions'],                 'true',                 6)) v(canon, tgt, lts, filt, ord) order by ord loop
    execute format('select count(*) from legacy_v.%I v where migration.in_scope(v.org_id) and %s', e.canon, e.filt) into n_legacy;
    execute format('select count(*) from public.%I where tenant_id = $1 and legacy_table = any($2)', e.tgt) using t, e.lts into n_new;
    execute format($q$select count(*), string_agg(legacy_id, ', ' order by legacy_id) filter (where rn <= 5)
                        from (select v.legacy_id, row_number() over (order by v.legacy_id) rn from legacy_v.%I v
                               where migration.in_scope(v.org_id) and %s
                                 and not exists (select 1 from public.%I x where x.tenant_id = $1 and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id)) q$q$,
                   e.canon, e.filt, e.tgt) using t into n_missing, sample;
    execute format($q$select count(*) from public.%I x where x.tenant_id = $1 and x.legacy_table = any($2)
                        and not exists (select 1 from legacy_v.%I v where v.legacy_table = x.legacy_table and v.legacy_id = x.legacy_id
                                          and migration.in_scope(v.org_id) and %s)$q$,
                   e.tgt, e.canon, e.filt) using t, e.lts into n_extra;
    i := i + 1; seq := i; check_name := 'row_count'; entity := e.canon || ' -> ' || e.tgt;
    expected := n_legacy::text; actual := n_new::text; status := case when n_legacy = n_new then 'PASS' else 'FAIL' end;
    detail := null; return next;
    i := i + 1; seq := i; check_name := 'every_legacy_id_present'; expected := '0 missing'; actual := n_missing || ' missing';
    status := case when n_missing = 0 then 'PASS' else 'FAIL' end; detail := sample; return next;
    i := i + 1; seq := i; check_name := 'no_rows_without_legacy_source'; expected := '0 extra'; actual := n_extra || ' extra';
    status := case when n_extra = 0 then 'PASS' else 'WARN' end;
    detail := case when n_extra > 0 then 'migrated rows whose V2 row is gone or was deleted in V2 after the load (kept, never deleted)' end; return next;
  end loop;

  select count(*) into n from migration.flagged_row where tenant_id = t and flag = 'soft_deleted_in_v2';
  i := i + 1; seq := i; check_name := 'soft_deleted_in_v2'; entity := 'accounts/contacts/properties/opportunities'; expected := 'legacy only'; actual := n::text;
  status := 'INFO'; detail := 'deleted in V2 before the copy; kept in legacy.*, not shown in Dilly (migration.flagged_row)'; return next;

  -- 1b. users
  select count(*) into n_legacy from legacy_v.users where migration.in_scope(org_id);
  select count(*), count(*) filter (where profile_id is null and invite_id is null), count(*) filter (where profile_id is not null)
    into n_new, n_missing, n from migration.user_map where tenant_id = t;
  i := i + 1; seq := i; check_name := 'row_count'; entity := 'users -> user_map'; expected := n_legacy::text; actual := n_new::text;
  status := case when n_legacy = n_new then 'PASS' else 'FAIL' end; detail := n || ' signed in (profile), ' || (n_new - n) || ' invited'; return next;
  i := i + 1; seq := i; check_name := 'users_have_profile_or_invite'; expected := '0 without'; actual := n_missing::text;
  status := case when n_missing = 0 then 'PASS' else 'WARN' end;
  select string_agg(coalesce(email, legacy_user_id), ', ') into detail from migration.user_map where tenant_id = t and profile_id is null and invite_id is null;
  detail := case when n_missing > 0 then 'no email in V2: ' || detail end;
  return next;

  -- 1c. property <-> contact links (one per property + contact)
  select count(*), count(*) filter (where pc2.property_id is null)
    into n_legacy, n_missing
    from (select distinct p.id as pid, c.id as cid
            from legacy_v.property_contacts pc
            join public.property p on p.tenant_id = t and p.legacy_table = 'properties' and p.legacy_id = pc.property_legacy_id
            join public.contact  c on c.tenant_id = t and c.legacy_table = 'contacts'   and c.legacy_id = pc.contact_legacy_id
           where migration.in_scope(pc.org_id) and pc.active) l
    left join public.property_contact pc2 on pc2.property_id = l.pid and pc2.contact_id = l.cid;
  i := i + 1; seq := i; check_name := 'row_count'; entity := 'property_contacts -> property_contact';
  expected := n_legacy::text || ' links'; actual := (n_legacy - n_missing)::text || ' links';
  status := case when n_missing = 0 then 'PASS' else 'FAIL' end;
  detail := (select count(*) filter (where flag = 'orphan_link') || ' orphan links, ' || count(*) filter (where flag = 'inactive_link') || ' inactive links (flagged)'
               from migration.flagged_row where tenant_id = t and legacy_table = 'property_contacts'); return next;

  -- 1d. ownership / management: each building's current account = V2's current manager, else owner
  with exp as (
    select p.id as pid,
           coalesce(max(a.id::text) filter (where d.role = 'manager'), max(a.id::text) filter (where d.role = 'owner'))::uuid as aid
      from legacy_v.properties lp
      join public.property p on p.tenant_id = t and p.legacy_table = 'properties' and p.legacy_id = lp.legacy_id
      left join legacy_v.property_parties d on d.property_legacy_id = lp.legacy_id and d.disposition = 'ok' and d.ended_on is null
      left join public.account a on a.tenant_id = t and a.legacy_table = 'accounts' and a.legacy_id = d.account_legacy_id
     where migration.in_scope(lp.org_id) and lp.deleted_at is null
       and not exists (select 1 from _app_owned_rc o where o.property_id = p.id)
     group by p.id
  )
  select count(*), count(*) filter (where exp.aid is distinct from p.account_id),
         string_agg(p.legacy_id, ', ') filter (where exp.aid is distinct from p.account_id)
    into n, n_missing, sample
    from exp join public.property p on p.id = exp.pid;
  i := i + 1; seq := i; check_name := 'property_current_party'; entity := 'properties'; expected := '0 differ';
  actual := n_missing || ' of ' || n || ' differ'; status := case when n_missing = 0 then 'PASS' else 'FAIL' end;
  detail := coalesce(left(sample, 400), (select count(*) || ' buildings changed in Dilly are owned by Dilly (excluded)' from _app_owned_rc)); return next;

  -- 2. opportunity value totals (value = final, else bid, else estimated)
  select coalesce(sum(value), 0) into s_legacy from legacy_v.opportunities where migration.in_scope(org_id) and deleted_at is null;
  select coalesce(sum(value_estimate), 0) into s_new from public.opportunity where tenant_id = t and legacy_table = 'opportunities';
  i := i + 1; seq := i; check_name := 'opportunity_value_total'; entity := 'opportunities';
  expected := to_char(s_legacy, 'FM999,999,999,990.00'); actual := to_char(s_new, 'FM999,999,999,990.00');
  status := case when s_legacy = s_new then 'PASS' else 'FAIL' end; detail := 'value = final_value, else bid_value, else estimated_value'; return next;
  for r in
    with l as (select migration.opp_stage(status, stage_name, stage_key) as k, count(*) n, sum(value) v
                 from legacy_v.opportunities where migration.in_scope(org_id) and deleted_at is null group by 1),
         x as (select stage::text as k, count(*) n, sum(value_estimate) v from public.opportunity where tenant_id = t and legacy_table = 'opportunities' group by 1)
    select coalesce(l.k, x.k) k, l.n ln, x.n xn, l.v lv, x.v xv from l full join x on l.k = x.k order by 1
  loop
    i := i + 1; seq := i; check_name := 'opportunities_per_stage'; entity := r.k;
    expected := coalesce(r.ln, 0) || ' / $' || coalesce(r.lv, 0); actual := coalesce(r.xn, 0) || ' / $' || coalesce(r.xv, 0);
    status := case when r.ln is not distinct from r.xn and r.lv is not distinct from r.xv then 'PASS' else 'FAIL' end; detail := null; return next;
  end loop;

  -- 3. touches per rep per ISO week (UTC; catches attribution and timestamp shifts)
  with l as (
    select coalesce(actor_legacy_user_id, '<none>') u, to_char(occurred_at at time zone 'UTC', 'IYYY-"W"IW') w, count(*) n
      from legacy_v.touches where migration.in_scope(org_id) group by 1, 2
  ), x as (
    select coalesce(um.legacy_user_id, ua.legacy_user_id, '<none>') u, to_char(tc.occurred_at at time zone 'UTC', 'IYYY-"W"IW') w, count(*) n
      from public.touch tc
      left join lateral (select legacy_user_id from migration.user_map where tenant_id = t and profile_id = tc.user_id
                          order by legacy_user_id limit 1) um on tc.user_id is not null
      left join migration.unmapped_actor ua on tc.user_id is null and ua.tenant_id = t and ua.legacy_table = tc.legacy_table
            and ua.legacy_id = tc.legacy_id and ua.role_column = 'actor'
     where tc.tenant_id = t and tc.legacy_table in ('touchpoints', 'synced_emails')
     group by 1, 2
  )
  select count(*) filter (where l.n is distinct from x.n), count(*),
         string_agg(coalesce(l.u, x.u) || ' ' || coalesce(l.w, x.w) || ': ' || coalesce(l.n, 0) || ' vs ' || coalesce(x.n, 0), '; ')
           filter (where l.n is distinct from x.n)
    into n, m, sample
    from l full join x on l.u = x.u and l.w = x.w;
  i := i + 1; seq := i; check_name := 'touches_per_rep_per_week'; entity := 'touches';
  expected := '0 mismatched rep-weeks'; actual := n || ' of ' || m || ' rep-weeks differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := left(sample, 500); return next;

  select count(*) filter (where legacy_table = 'synced_emails'),
         (select count(*) from legacy.synced_emails s where migration.in_scope(s.org_id) and s.touchpoint_id is not null)
    into n, m from legacy_v.touches where migration.in_scope(org_id);
  i := i + 1; seq := i; check_name := 'synced_emails'; entity := 'synced_emails'; expected := 'info';
  actual := m || ' already touchpoints (Gmail id kept), ' || n || ' unlogged -> touches';
  status := 'INFO'; detail := (select count(*) || ' in scope; the rest had no matched contact or an email touchpoint within 10 min (legacy only)'
                                 from legacy.synced_emails s where migration.in_scope(s.org_id)); return next;

  -- 4/5. contacts per account, properties per account
  with l as (select v.account_legacy_id a, count(*) n from legacy_v.contacts v
              where migration.in_scope(v.org_id) and v.deleted_at is null and v.account_legacy_id is not null
                and exists (select 1 from legacy_v.accounts la where la.legacy_id = v.account_legacy_id and migration.in_scope(la.org_id) and la.deleted_at is null)
              group by 1),
       x as (select a.legacy_id a, count(*) n from public.contact c join public.account a on a.id = c.account_id
              where c.tenant_id = t and c.legacy_table = 'contacts' and a.legacy_table = 'accounts' group by 1)
  select count(*) filter (where l.n is distinct from x.n), count(*),
         string_agg(coalesce(l.a, x.a) || ': ' || coalesce(l.n, 0) || ' vs ' || coalesce(x.n, 0), '; ') filter (where l.n is distinct from x.n)
    into n, m, sample from l full join x on l.a = x.a;
  i := i + 1; seq := i; check_name := 'contacts_per_account'; entity := 'accounts';
  expected := '0 accounts differ'; actual := n || ' of ' || m || ' accounts differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := left(sample, 500); return next;

  with l as (select a.id::text a, count(*) n
               from (select d.property_legacy_id,
                            coalesce(max(d.account_legacy_id) filter (where d.role = 'manager'), max(d.account_legacy_id) filter (where d.role = 'owner')) acc
                       from legacy_v.property_parties d
                       join legacy_v.properties lp on lp.legacy_id = d.property_legacy_id and lp.deleted_at is null
                      where migration.in_scope(d.org_id) and d.disposition = 'ok' and d.ended_on is null
                      group by 1) q
               join public.property p on p.tenant_id = t and p.legacy_table = 'properties' and p.legacy_id = q.property_legacy_id
               join public.account a on a.tenant_id = t and a.legacy_table = 'accounts' and a.legacy_id = q.acc
              where not exists (select 1 from _app_owned_rc o where o.property_id = p.id)
              group by 1),
       x as (select p.account_id::text a, count(*) n from public.property p
              where p.tenant_id = t and p.legacy_table = 'properties' and p.account_id is not null
                and not exists (select 1 from _app_owned_rc o where o.property_id = p.id)
              group by 1)
  select count(*) filter (where l.n is distinct from x.n), count(*),
         string_agg(coalesce(l.a, x.a) || ': ' || coalesce(l.n, 0) || ' vs ' || coalesce(x.n, 0), '; ') filter (where l.n is distinct from x.n)
    into n, m, sample from l full join x on l.a = x.a;
  i := i + 1; seq := i; check_name := 'properties_per_account'; entity := 'accounts';
  expected := '0 accounts differ'; actual := n || ' of ' || m || ' accounts differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := left(sample, 500); return next;

  select count(*) into n from migration.flagged_row where tenant_id = t and flag in ('orphan', 'orphan_link', 'orphan_property');
  i := i + 1; seq := i; check_name := 'orphans_migrated_unlinked'; entity := 'all'; expected := 'counted'; actual := n::text;
  status := 'INFO'; detail := 'rows whose V2 parent is missing or soft-deleted; migrated with the link empty (migration.flagged_row)'; return next;

  -- 6. notes length (no truncation, no lost notes)
  for r in
    select 'accounts.notes' k, count(*) filter (where length(v.notes) is distinct from length(x.notes)) bad,
           coalesce(sum(length(v.notes)), 0) lsum, coalesce(sum(length(x.notes)), 0) xsum
      from legacy_v.accounts v join public.account x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
     where migration.in_scope(v.org_id)
    union all
    select 'properties.notes', count(*) filter (where length(v.notes) is distinct from length(x.notes)), coalesce(sum(length(v.notes)), 0), coalesce(sum(length(x.notes)), 0)
      from legacy_v.properties v join public.property x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
     where migration.in_scope(v.org_id)
    union all
    select 'touches.notes', count(*) filter (where length(v.notes) is distinct from length(x.notes)), coalesce(sum(length(v.notes)), 0), coalesce(sum(length(x.notes)), 0)
      from legacy_v.touches v join public.touch x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
     where migration.in_scope(v.org_id)
    union all
    select 'next_actions.notes -> task.reason', count(*) filter (where nullif(btrim(v.notes), '') is not null and length(btrim(v.notes)) <> length(x.reason)),
           coalesce(sum(length(btrim(v.notes))) filter (where nullif(btrim(v.notes), '') is not null), 0),
           coalesce(sum(length(x.reason)) filter (where nullif(btrim(v.notes), '') is not null), 0)
      from legacy_v.follow_ups v join public.task x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
     where migration.in_scope(v.org_id)
  loop
    i := i + 1; seq := i; check_name := 'notes_length'; entity := r.k;
    expected := r.lsum || ' chars'; actual := r.xsum || ' chars, ' || r.bad || ' rows differ';
    status := case when r.bad = 0 and r.lsum = r.xsum then 'PASS' else 'FAIL' end; detail := null; return next;
  end loop;

  -- 7. touch ledger fidelity: channel / outcome / direction / time / rep match the mapped V2 row
  select count(*), string_agg(v.legacy_id, ', ')
    into n, sample
    from legacy_v.touches v
    join public.touch x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
   where migration.in_scope(v.org_id)
     and (x.channel::text <> migration.map('touch_type', v.type_name, v.type_key)
       or x.outcome::text <> migration.map('touch_outcome', v.outcome_name, v.outcome_key)
       or x.direction <> migration.map('touch_direction', v.direction)
       or x.occurred_at <> v.occurred_at
       or (x.user_id is distinct from migration.uid(v.actor_legacy_user_id) and x.user_id is not null));
  i := i + 1; seq := i; check_name := 'touch_fields_match'; entity := 'touches'; expected := '0 rows differ'; actual := n || ' rows differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end;
  detail := case when n > 0 then 'edited in V2 after the first load; void + re-log these in Dilly: ' || left(sample, 400) end; return next;

  select count(*) into n
    from legacy_v.follow_ups v
    join public.task x on x.tenant_id = t and x.legacy_table = v.legacy_table and x.legacy_id = v.legacy_id
    left join public.touch ft on ft.tenant_id = t and ft.legacy_table = 'touchpoints' and ft.legacy_id = v.created_from_touchpoint_legacy_id
   where migration.in_scope(v.org_id)
     and (x.due_on <> coalesce(v.due_on, v.created_at::date)
       or x.created_at <> case when ft.occurred_at >= v.created_at then ft.occurred_at + interval '1 millisecond' else v.created_at end);
  i := i + 1; seq := i; check_name := 'task_dates_match'; entity := 'follow_ups'; expected := '0 rows differ'; actual := n || ' rows differ';
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := 'created_at + due date preserved (auto-close depends on them)'; return next;

  -- 8. timezone spot check: 10 touches side by side (stored UTC; shown in tenant time)
  for r in
    select v.legacy_id, v.occurred_at as l_ts, x.occurred_at as x_ts, (select timezone from public.tenant where id = t) as tz
      from legacy_v.touches v
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

  -- 9. distributions: account type, onboarding ladder, preferences
  for r in
    with l as (select migration.map('account_type', account_type) k, count(*) n from legacy_v.accounts where migration.in_scope(org_id) and deleted_at is null group by 1),
         x as (select account_type::text k, count(*) n from public.account where tenant_id = t and legacy_table = 'accounts' group by 1)
    select 'account_type ' || coalesce(l.k, x.k) k, l.n ln, x.n xn from l full join x on l.k = x.k
    union all
    select * from (
      with l as (select migration.map('onboarding_status', onboarding_status) k, count(*) n from legacy_v.accounts where migration.in_scope(org_id) and deleted_at is null group by 1),
           x as (select onboarding_status::text k, count(*) n from public.account where tenant_id = t and legacy_table = 'accounts' group by 1)
      select 'onboarding ' || coalesce(l.k, x.k), l.n, x.n from l full join x on l.k = x.k) o
    union all
    select * from (
      with l as (select migration.map('account_status', status) k, count(*) n from legacy_v.accounts where migration.in_scope(org_id) and deleted_at is null
                  and migration.map('account_status', status) is not null group by 1),
           x as (select p.preference::text k, count(*) n from public.account_preference p join public.account a on a.id = p.account_id
                  where p.tenant_id = t and a.legacy_table = 'accounts' and p.reason like 'Dilly V2 status:%' group by 1)
      select 'preference ' || coalesce(l.k, x.k), l.n, x.n from l full join x on l.k = x.k) p
    order by 1
  loop
    i := i + 1; seq := i; check_name := 'distribution'; entity := r.k; expected := coalesce(r.ln, 0)::text; actual := coalesce(r.xn, 0)::text;
    status := case when r.ln is not distinct from r.xn then 'PASS' else 'FAIL' end; detail := null; return next;
  end loop;

  -- 10. follow-ups: every open task with a later touch is closed; migration created no tasks and no points
  select count(*) into n from public.task k
   where k.tenant_id = t and k.status = 'open'
     and exists (select 1 from public.touch x where x.tenant_id = t and x.voided_at is null and x.occurred_at >= k.created_at
                   and ((k.contact_id is not null and x.contact_id = k.contact_id) or (k.contact_id is null and x.account_id = k.account_id)));
  i := i + 1; seq := i; check_name := 'open_tasks_with_later_touch'; entity := 'tasks'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := 'app.reconcile_tasks must have run (03-transform.sql does)'; return next;

  select count(*) filter (where k.status = 'open'),
         count(*) filter (where k.status = 'done' and k.completed_by_touch_id is not null and migration.map('task_status', v.status) = 'open')
    into n, m
    from public.task k left join legacy_v.follow_ups v on v.legacy_id = k.legacy_id
   where k.tenant_id = t and k.legacy_table = 'next_actions';
  i := i + 1; seq := i; check_name := 'follow_ups_auto_closed'; entity := 'tasks'; expected := 'info';
  actual := m || ' V2-open follow-ups closed by a later touch; ' || n || ' still open';
  status := 'INFO'; detail := null; return next;

  select (select count(*) from public.task k join public.touch x on x.id = k.created_from_touch_id
           where k.tenant_id = t and x.source = 'dillyv2' and k.source <> 'dillyv2')
       + (select count(*) from public.point_event pe join public.touch x on x.id = pe.touch_id where pe.tenant_id = t and x.source = 'dillyv2')
    into n;
  i := i + 1; seq := i; check_name := 'migration_created_no_tasks_or_points'; entity := 'touches'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := 'migrated history never schedules work or scores'; return next;

  -- 11. provenance: no dillyv2 row without a legacy id
  select (select count(*) from public.account where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.contact where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.property where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.opportunity where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.touch where source = 'dillyv2' and legacy_id is null)
       + (select count(*) from public.task where source = 'dillyv2' and legacy_id is null)
    into n;
  i := i + 1; seq := i; check_name := 'dillyv2_rows_have_legacy_id'; entity := 'all'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'FAIL' end; detail := null; return next;

  -- 12. V2 points kept for comparison (not migrated as points)
  select coalesce(sum(nullif(legacy_points, '')::numeric), 0) into s_legacy from legacy_v.users where migration.in_scope(org_id);
  select coalesce(sum(value::numeric), 0) into s_new from migration.legacy_value where tenant_id = t and legacy_table = 'org_users' and field = 'legacy_points';
  i := i + 1; seq := i; check_name := 'legacy_points_kept'; entity := 'users'; expected := s_legacy::text; actual := s_new::text;
  status := case when s_legacy = s_new then 'PASS' else 'FAIL' end; detail := 'sum of V2 score_events per person; Dilly recomputes points'; return next;

  -- 13. people not signed in yet (nothing dropped; user columns empty until they sign in and 03 is re-run)
  select count(*), count(distinct legacy_user_id), string_agg(distinct coalesce(legacy_email, legacy_user_id), ', ')
    into n, m, sample from migration.unmapped_actor where tenant_id = t and resolved_profile_id is null;
  i := i + 1; seq := i; check_name := 'unmapped_actors'; entity := 'users'; expected := '0'; actual := n || ' rows / ' || m || ' people';
  status := case when n = 0 then 'PASS' else 'WARN' end;
  detail := case when n > 0 then 'have them sign in to Dilly, then re-run 03-transform.sql: ' || left(sample, 400) end; return next;
  select count(*) into n from migration.unmapped_actor a join public.touch x on x.tenant_id = a.tenant_id and x.legacy_table = a.legacy_table
     and x.legacy_id = a.legacy_id where a.tenant_id = t and a.role_column = 'actor' and a.resolved_profile_id is not null and x.user_id is null;
  i := i + 1; seq := i; check_name := 'touches_awaiting_reattribute'; entity := 'touch'; expected := '0'; actual := n::text;
  status := case when n = 0 then 'PASS' else 'WARN' end; detail := case when n > 0 then 're-run 03-transform.sql' end; return next;

  -- 14. flags and duplicate suggestions (informational: nothing dropped, nothing merged)
  for r in select flag, count(*) n from migration.flagged_row where tenant_id = t group by 1 order by 1 loop
    i := i + 1; seq := i; check_name := 'flagged_rows'; entity := r.flag; expected := 'review'; actual := r.n::text; status := 'INFO';
    detail := 'select * from migration.flagged_row where flag = ' || quote_literal(r.flag); return next;
  end loop;
  for r in select d.entity as ent, count(*) n from migration.duplicate_suggestion d where d.tenant_id = t group by 1 order by 1 loop
    i := i + 1; seq := i; check_name := 'duplicate_suggestions'; entity := r.ent; expected := 'review'; actual := r.n::text; status := 'INFO';
    detail := 'not merged; migration.duplicate_suggestion'; return next;
  end loop;
end $fn$;

with r as (select * from migration.reconcile())
select 0 as seq, 'VERDICT' as check_name, 'cutover' as entity, '0 FAIL' as expected,
       count(*) filter (where status = 'FAIL') || ' FAIL, ' || count(*) filter (where status = 'WARN') || ' WARN, '
         || count(*) filter (where status = 'PASS') || ' PASS' as actual,
       case when count(*) filter (where status = 'FAIL') = 0 then 'PASS' else 'FAIL' end as status,
       case when count(*) filter (where status = 'FAIL') = 0 then 'OK to cut over (review WARN/INFO rows)' else 'DO NOT cut over: fix the FAIL rows below' end as detail
  from r
union all
select * from r
order by 1;
