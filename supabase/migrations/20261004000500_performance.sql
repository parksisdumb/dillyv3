-- Dilly — launch performance pass. Additive only: new helper functions, new indexes, policies recreated
-- with identical semantics, and public.health() for the uptime monitor.
--
-- Measured with scripts/local/loadtest.sql (2,000 accounts / 10,000 contacts / 8,000 properties /
-- 50,000 touches / 5,000 tasks in one tenant, RLS on, as a rep). See docs/RUNBOOK.md for numbers.

-- ---------------------------------------------------------------------------
-- 1) RLS: evaluate membership ONCE per statement instead of once per row.
--
-- Before: `using (app.is_member(tenant_id))` — a SECURITY DEFINER function (never inlined) that runs
-- is_platform_admin() + an EXISTS on membership for every row scanned. On 50k touches that was ~3 s.
-- After:  `using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))` — the scalar subquery becomes an
-- InitPlan, computed once, and the per-row check is an array membership test.
--
-- Semantics are identical to app.is_member(t): platform admins see every tenant; everyone else sees the
-- tenants where they hold an active membership. auth.uid() is fixed for the statement either way.
-- app.is_member / app.has_role stay (other functions and the delete/write policies still use them).
-- ---------------------------------------------------------------------------
create or replace function app.my_tenant_ids() returns uuid[] language sql stable security definer set search_path = public, app as $$
  select case
    when app.is_platform_admin() then array(select t.id from public.tenant t)
    else array(select m.tenant_id from public.membership m where m.user_id = auth.uid() and m.active)
  end
$$;
grant execute on function app.my_tenant_ids() to authenticated, service_role;

-- Standard tenant tables: select / insert / update (delete keeps has_role — low volume, per-row is fine).
do $$
declare t text;
begin
  for t in select unnest(array[
    'account','account_assignment','contact','property','property_contact','opportunity',
    'account_preference','task','segment','tenant_market'])
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))
                      with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
  end loop;
end $$;

-- Read-only to members.
do $$
declare t text;
begin
  for t in select unnest(array['point_event','work_item','agent_run','trust_score','brief','insight','rep_day'])
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
  end loop;
end $$;

drop policy if exists agent_step_select on public.agent_step;
create policy agent_step_select on public.agent_step for select to authenticated
  using (exists (select 1 from public.agent_run r where r.id = run_id and r.tenant_id = any ((select app.my_tenant_ids())::uuid[])));

drop policy if exists tenant_select on public.tenant;
create policy tenant_select on public.tenant for select to authenticated using (id = any ((select app.my_tenant_ids())::uuid[]));

drop policy if exists membership_select on public.membership;
create policy membership_select on public.membership for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));

drop policy if exists targeting_select on public.tenant_targeting;
create policy targeting_select on public.tenant_targeting for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));

drop policy if exists signal_select on public.signal;
create policy signal_select on public.signal for select to authenticated
  using (tenant_id is null or tenant_id = any ((select app.my_tenant_ids())::uuid[]));
drop policy if exists signal_insert on public.signal;
create policy signal_insert on public.signal for insert to authenticated
  with check (tenant_id is not null and tenant_id = any ((select app.my_tenant_ids())::uuid[]));

drop policy if exists outcome_rule_select on public.outcome_rule;
create policy outcome_rule_select on public.outcome_rule for select to authenticated
  using (tenant_id is null or tenant_id = any ((select app.my_tenant_ids())::uuid[]));
drop policy if exists point_rule_select on public.point_rule;
create policy point_rule_select on public.point_rule for select to authenticated
  using (tenant_id is null or tenant_id = any ((select app.my_tenant_ids())::uuid[]));

drop policy if exists touch_select on public.touch;
create policy touch_select on public.touch for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
drop policy if exists touch_insert on public.touch;
create policy touch_insert on public.touch for insert to authenticated with check (
  tenant_id = any ((select app.my_tenant_ids())::uuid[])
  and (user_id = auth.uid() or app.has_role(tenant_id, array['owner','admin','manager'])));

drop policy if exists approval_select on public.approval;
create policy approval_select on public.approval for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));

-- ---------------------------------------------------------------------------
-- 2) Hot-path indexes. (task(tenant_id, assignee_user_id, status, due_on) already exists: task_queue_idx.)
-- ---------------------------------------------------------------------------
create index if not exists touch_tenant_time_idx      on public.touch(tenant_id, occurred_at desc);
create index if not exists touch_property_idx         on public.touch(property_id, occurred_at desc) where property_id is not null;
create index if not exists point_event_tenant_time_idx on public.point_event(tenant_id, occurred_at);
create index if not exists account_owner_touch_idx    on public.account(tenant_id, owner_user_id, last_touch_at);
create index if not exists opportunity_owner_idx      on public.opportunity(tenant_id, owner_user_id, stage);
create index if not exists opportunity_account_idx    on public.opportunity(account_id);
create index if not exists opportunity_property_idx   on public.opportunity(property_id) where property_id is not null;
create index if not exists contact_tenant_account_idx on public.contact(tenant_id, account_id);
create index if not exists property_tenant_city_idx   on public.property(tenant_id, city);
create index if not exists property_name_trgm         on public.property using gin (name gin_trgm_ops);
create index if not exists property_address_trgm      on public.property using gin (address1 gin_trgm_ops);
create index if not exists property_city_trgm         on public.property using gin (city gin_trgm_ops);
-- logTouch reads back what its trigger did by these FKs; they are also ON DELETE SET NULL targets.
create index if not exists task_completed_by_touch_idx on public.task(completed_by_touch_id) where completed_by_touch_id is not null;
create index if not exists task_created_from_touch_idx on public.task(created_from_touch_id) where created_from_touch_id is not null;

-- ---------------------------------------------------------------------------
-- 3) Uptime probe: GET /api/health calls this with the anon key. Touches no tables, returns DB time.
-- ---------------------------------------------------------------------------
create or replace function public.health() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.health() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) FOR ALL write policies are also OR'd into SELECT, so their per-row app.has_role() ran on every read
--    (tenant_targeting is read once per account by account_ranked). Same InitPlan trick, same semantics as
--    app.has_role(t, roles): platform admin, or an active membership in t with one of the roles.
-- ---------------------------------------------------------------------------
create or replace function app.my_tenant_ids_with_role(roles text[]) returns uuid[] language sql stable security definer set search_path = public, app as $$
  select case
    when app.is_platform_admin() then array(select t.id from public.tenant t)
    else array(select m.tenant_id from public.membership m where m.user_id = auth.uid() and m.active and m.role = any(roles))
  end
$$;
grant execute on function app.my_tenant_ids_with_role(text[]) to authenticated, service_role;

drop policy if exists targeting_write on public.tenant_targeting;
create policy targeting_write on public.tenant_targeting for all to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]))
  with check (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]));

drop policy if exists outcome_rule_write on public.outcome_rule;
create policy outcome_rule_write on public.outcome_rule for all to authenticated
  using (tenant_id is not null and tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]))
  with check (tenant_id is not null and tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]));

drop policy if exists point_rule_write on public.point_rule;
create policy point_rule_write on public.point_rule for all to authenticated
  using (tenant_id is not null and tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]))
  with check (tenant_id is not null and tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]));

drop policy if exists membership_write on public.membership;
create policy membership_write on public.membership for all to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]))
  with check (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]));

drop policy if exists invite_all on public.invite;
create policy invite_all on public.invite for all to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]))
  with check (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]));

-- ---------------------------------------------------------------------------
-- 5) account_ranked: identical columns, types and semantics; each per-account aggregate now runs ONCE.
--    The old CTEs were inlined and every reference to open_opps / property_count / target_excluded
--    re-ran its correlated subquery (up to 3× per row). LATERAL aggregates cannot be pulled up, so each
--    is evaluated exactly once per surviving account row, after tenant/owner/id filters are applied.
--    Targeting exclude + include weight now come from one pass over tenant_targeting.
-- ---------------------------------------------------------------------------
create or replace view public.account_ranked with (security_invoker = true) as
with base as (
  select a.*,
         m.slug as market_slug,
         pc.n as property_count,
         cc.n as contact_count,
         oo.n as open_opps,
         oo.v as open_value,
         tk.n as open_tasks,
         pref.preference,
         pref.reason as preference_reason,
         extract(day from now() - a.last_touch_at)::int as days_since_touch
    from public.account a
    left join public.market m on m.id = a.market_id
    left join public.account_preference pref
           on pref.account_id = a.id and pref.tenant_id = a.tenant_id
          and (pref.expires_on is null or pref.expires_on >= current_date)
    cross join lateral (select count(*) as n from public.property p where p.account_id = a.id and not p.is_test) pc
    cross join lateral (select count(*) as n from public.contact c where c.account_id = a.id and not c.is_test) cc
    cross join lateral (select count(*) as n, coalesce(sum(o.value_estimate),0) as v
                          from public.opportunity o where o.account_id = a.id and o.stage not in ('won','lost')) oo
    cross join lateral (select count(*) as n from public.task k where k.account_id = a.id and k.status = 'open') tk
   where a.duplicate_of is null
), targeted as (
  select b.*,
         tg.excluded as target_excluded,
         tg.weight as target_weight
    from base b
    cross join lateral (
      select coalesce(bool_or(true) filter (where tt.mode = 'exclude'), false) as excluded,
             coalesce((exp(sum(ln(greatest(tt.weight, 0.0001))) filter (where tt.mode = 'include')))::numeric, 1.0) as weight
        from public.tenant_targeting tt
       where tt.tenant_id = b.tenant_id
         and ((tt.dimension = 'account_type' and tt.value = b.account_type)
           or (tt.dimension = 'market' and tt.value = b.market_slug))) tg
)
select t.*,
       case
         when t.preference in ('do_not_pursue','competitor') then 'do_not_pursue'
         when t.target_excluded then 'excluded'
         when t.owner_user_id is null then 'unassigned'
         when t.last_touch_at is null then 'not_started'
         when t.days_since_touch > app.cold_threshold_days(t.icp_tier) then 'cold'
         else 'active'
       end as relationship_state,
       (t.last_touch_at is not null and t.days_since_touch > app.cold_threshold_days(t.icp_tier)) as is_cold,
       case
         when t.preference in ('do_not_pursue','competitor') or t.target_excluded then 0
         else round(((
                (case t.icp_tier when 1 then 100 when 2 then 70 when 3 then 45 else 25 end)
              + least(t.open_opps * 6, 24)
              + least(t.open_value / 10000.0, 20)
              + 5 * ln(1 + t.property_count)::numeric
              + case when t.last_touch_at is not null and t.days_since_touch > app.cold_threshold_days(t.icp_tier)
                          and t.icp_tier <= 2 then 15 else 0 end
              + t.score
              ) * t.target_weight
                * case t.preference when 'deprioritize' then 0.05 when 'pursue' then 1.25
                                    when 'existing_client' then 1.10 when 'partner' then 0.80 else 1.0 end)::numeric, 1)
       end as rank_score,
       case
         when t.preference in ('do_not_pursue','competitor') then coalesce(t.preference_reason, 'Marked ' || replace(t.preference,'_',' '))
         when t.target_excluded then 'Outside this company''s targeting'
         else null
       end as excluded_reason
  from targeted t;

-- ---------------------------------------------------------------------------
-- 6) rep_queue: same body; the `d` CTE is MATERIALIZED so app.tenant_today() runs once per call instead of
--    several times per task row (it was inlined into the filter, overdue_days and the score).
-- ---------------------------------------------------------------------------
create or replace function public.rep_queue(p_tenant uuid, p_user uuid, p_day date default null)
returns table (
  item_type text, task_id uuid, account_id uuid, contact_id uuid, opportunity_id uuid, property_id uuid,
  title text, reason text, due_on date, overdue_days int, score numeric,
  account_name text, contact_name text, phone text, email text, icp_tier smallint
) language sql stable as $$
  with d as materialized (select coalesce(p_day, app.tenant_today(p_tenant)) as day)
  -- 1) Open tasks due today or earlier.
  select 'task', k.id, k.account_id, k.contact_id, k.opportunity_id, k.property_id,
         k.title, k.reason, k.due_on, greatest(d.day - k.due_on, 0),
         k.priority + 3 * least(greatest(d.day - k.due_on, 0), 10) + (5 - coalesce(a.icp_tier,3)) * 10
           + least(coalesce(o.value_estimate,0) / 5000.0, 20),
         a.name, c.full_name, coalesce(c.mobile, c.phone), c.email::text, a.icp_tier
    from public.task k cross join d
    left join public.account a on a.id = k.account_id
    left join public.contact c on c.id = k.contact_id
    left join public.opportunity o on o.id = k.opportunity_id
    left join public.account_preference ap on ap.account_id = k.account_id and ap.tenant_id = k.tenant_id
   where k.tenant_id = p_tenant and k.assignee_user_id = p_user and k.status = 'open' and k.due_on <= d.day
     and coalesce(ap.preference,'') not in ('do_not_pursue','competitor')
  union all
  -- 2) P1/P2 accounts I own that went cold with nothing scheduled.
  select 'reengage', null, r.id, null, null, null,
         'Re-engage ' || r.name,
         'P' || r.icp_tier || ' quiet ' || r.days_since_touch || ' days (threshold ' || app.cold_threshold_days(r.icp_tier) || ')',
         null, null, 40 + (3 - r.icp_tier) * 15 + least(r.days_since_touch - app.cold_threshold_days(r.icp_tier), 30),
         r.name, null, r.phone, null, r.icp_tier
    from public.account_ranked r
   where r.tenant_id = p_tenant and r.owner_user_id = p_user and r.relationship_state = 'cold'
     and r.icp_tier <= 2 and r.open_tasks = 0
  union all
  -- 3) Assigned accounts never touched — first touches, best first, capped.
  select * from (
    select 'first_touch', null::uuid, r.id, null::uuid, null::uuid, null::uuid,
           'First touch: ' || r.name,
           coalesce(r.score_reasons->>0, 'P' || r.icp_tier || ' · ' || r.property_count || ' properties'),
           null::date, null::int, r.rank_score * 0.4, r.name, null::text, r.phone, null::text, r.icp_tier
      from public.account_ranked r
     where r.tenant_id = p_tenant and r.owner_user_id = p_user and r.relationship_state = 'not_started'
     order by r.rank_score desc limit 10) ft
  order by 11 desc
$$;
