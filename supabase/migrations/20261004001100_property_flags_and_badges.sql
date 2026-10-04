-- Dilly — property condition flags (one tap in the field), the property_current read model that feeds badges,
-- and rep_queue's boost for door-opener tasks (management-change intros, reconnects).

-- ---------------------------------------------------------------------------
-- Condition flags. Clearing keeps history (cleared_at); rows are never deleted.
-- ---------------------------------------------------------------------------
create domain app.property_flag as text check (value in (
  'active_leak','ponding','hail_damage','wind_damage','membrane_damage','flashing_issue',
  'drainage_issue','roof_access_issue','safety_hazard','insurance_claim'));

create table public.property_flag (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  property_id uuid not null references public.property(id) on delete cascade,
  flag        app.property_flag not null,
  note        text,
  set_by      uuid references public.profile(id),
  set_at      timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  uuid references public.profile(id),
  check (cleared_at is null or cleared_at >= set_at)
);
create unique index property_flag_active_uq on public.property_flag(property_id, flag) where cleared_at is null;
create index property_flag_property_idx on public.property_flag(property_id, set_at desc);
create index property_flag_tenant_idx on public.property_flag(tenant_id);

-- Only the clear fields (and the note) may change, and a cleared flag stays cleared.
create or replace function app.property_flag_guard() returns trigger language plpgsql as $$
begin
  if (new.tenant_id, new.property_id, new.flag, new.set_by, new.set_at) is distinct from
     (old.tenant_id, old.property_id, old.flag, old.set_by, old.set_at)
     or (old.cleared_at is not null and new.cleared_at is distinct from old.cleared_at) then
    raise exception 'property flags are history; set a new flag instead' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger property_flag_guard before update on public.property_flag for each row execute function app.property_flag_guard();

create or replace function app.property_flag_tenant_check() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from public.property where id = new.property_id and tenant_id = new.tenant_id) then
    raise exception 'property not found' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger property_flag_tenant before insert on public.property_flag for each row execute function app.property_flag_tenant_check();

alter table public.property_flag enable row level security;
create policy property_flag_select on public.property_flag for select to authenticated using (app.is_member(tenant_id));
create policy property_flag_insert on public.property_flag for insert to authenticated with check (app.is_member(tenant_id));
create policy property_flag_update on public.property_flag for update to authenticated using (app.is_member(tenant_id)) with check (app.is_member(tenant_id));
-- No delete policy: flags are history.
grant select, insert, update on public.property_flag to authenticated;
grant all on public.property_flag to service_role;

-- One-tap toggle. Returns the flag's state after the call. SECURITY INVOKER (RLS applies).
create or replace function public.set_property_flag(p_property uuid, p_flag text, p_on boolean, p_note text default null)
returns boolean language plpgsql security invoker set search_path = public, app as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.property where id = p_property;
  if v_tenant is null then raise exception 'property not found' using errcode = 'P0002'; end if;
  if p_on then
    insert into public.property_flag(tenant_id, property_id, flag, note, set_by)
    values (v_tenant, p_property, p_flag, nullif(trim(p_note), ''), auth.uid())
    on conflict (property_id, flag) where cleared_at is null do nothing;
  else
    update public.property_flag set cleared_at = now(), cleared_by = auth.uid()
     where property_id = p_property and flag = p_flag and cleared_at is null;
  end if;
  return p_on;
end $$;
grant execute on function public.set_property_flag(uuid, text, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Signals by building / market (storm badges, management-change history).
-- ---------------------------------------------------------------------------
create index if not exists signal_property_time_idx on public.signal(property_id, occurred_at desc) where property_id is not null;
create index if not exists signal_market_time_idx   on public.signal(market_id, occurred_at desc) where market_id is not null and property_id is null;

-- Storm-type signal kinds that badge a building.
create or replace function app.is_storm_kind(k text) returns boolean language sql immutable as $$
  select k in ('storm','hail','wind','hail_storm','wind_storm','severe_weather','storm_hail','storm_wind','tornado')
$$;

-- ---------------------------------------------------------------------------
-- property_current: every property column + current owner / manager + the data badges are computed from.
-- security_invoker: RLS of every underlying table applies.
-- ---------------------------------------------------------------------------
create or replace view public.property_current with (security_invoker = true) as
select p.*,
       own.account_id   as current_owner_id,
       oa.name          as current_owner_name,
       own.started_on   as owner_since,
       mgr.account_id   as current_manager_id,
       ma.name          as current_manager_name,
       mgr.started_on   as manager_since,
       -- Set only when the current row replaced an earlier one (a real change, not the first link).
       case when mgr.account_id is not null and exists (
              select 1 from public.property_party x where x.property_id = p.id and x.role = 'manager' and x.ended_on is not null)
            then coalesce(mgr.started_on, (mgr.created_at)::date) end as management_changed_on,
       case when own.account_id is not null and exists (
              select 1 from public.property_party x where x.property_id = p.id and x.role = 'owner' and x.ended_on is not null)
            then coalesce(own.started_on, (own.created_at)::date) end as ownership_changed_on,
       coalesce(fl.flags, '{}'::text[])          as active_flags,
       coalesce(op.service_lines, '{}'::text[])  as open_service_lines,
       coalesce(op.n, 0)::int                    as open_opp_count,
       coalesce(op.v, 0)::numeric                as open_opp_value,
       st.kind                                   as storm_kind,
       st.occurred_at                            as storm_at,
       st.headline                               as storm_headline
  from public.property p
  left join lateral (select x.account_id, x.started_on, x.created_at from public.property_party x
                      where x.property_id = p.id and x.role = 'owner' and x.ended_on is null) own on true
  left join public.account oa on oa.id = own.account_id
  left join lateral (select x.account_id, x.started_on, x.created_at from public.property_party x
                      where x.property_id = p.id and x.role = 'manager' and x.ended_on is null) mgr on true
  left join public.account ma on ma.id = mgr.account_id
  left join lateral (select array_agg(f.flag::text order by f.set_at desc) as flags from public.property_flag f
                      where f.property_id = p.id and f.cleared_at is null) fl on true
  left join lateral (select array_agg(distinct o.service_line::text) as service_lines, count(*) as n,
                            sum(coalesce(o.value_estimate, 0)) as v
                       from public.opportunity o
                      where o.property_id = p.id and o.stage not in ('won','lost')) op on true
  left join lateral (select s.kind, s.occurred_at, s.headline from public.signal s
                      where app.is_storm_kind(s.kind) and s.occurred_at > now() - interval '30 days'
                        and (s.tenant_id is null or s.tenant_id = p.tenant_id)
                        and (s.property_id = p.id
                             or (p.market_id is not null and s.market_id = p.market_id and s.property_id is null and s.account_id is null))
                      order by s.occurred_at desc limit 1) st on true;

grant select on public.property_current to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- rep_queue: identical to 20261004000500_performance.sql plus task.boost in the task score, so a management
-- change intro (boost 100) and a reconnect with someone who changed companies (boost 40) lead the day.
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
         k.priority + k.boost + 3 * least(greatest(d.day - k.due_on, 0), 10) + (5 - coalesce(a.icp_tier,3)) * 10
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
