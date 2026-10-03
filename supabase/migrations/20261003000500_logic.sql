-- Dilly — read models and business functions: ranking, the rep queue, streaks, leaderboard, onboarding.

-- ---------------------------------------------------------------------------
-- Identity helpers
-- ---------------------------------------------------------------------------
create table public.platform_admin_email (email citext primary key);

create or replace function app.is_platform_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin from public.profile where id = auth.uid()), false)
$$;

create or replace function app.is_member(t uuid) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.is_platform_admin() or exists (
    select 1 from public.membership m where m.tenant_id = t and m.user_id = auth.uid() and m.active)
$$;

create or replace function app.has_role(t uuid, roles text[]) returns boolean language sql stable security definer set search_path = public, app as $$
  select app.is_platform_admin() or exists (
    select 1 from public.membership m where m.tenant_id = t and m.user_id = auth.uid() and m.active and m.role = any(roles))
$$;

-- New auth user → profile.
create or replace function app.on_auth_user() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  insert into public.profile(id, email, full_name, is_platform_admin)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name',
          exists (select 1 from public.platform_admin_email p where p.email = new.email::citext))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.on_auth_user();

-- Called by the app after sign-in: turns invites for my email into memberships. Returns tenants joined.
create or replace function public.claim_invites() returns int language plpgsql security definer set search_path = public, app as $$
declare me public.profile; n int := 0;
begin
  select * into me from public.profile where id = auth.uid();
  if me.id is null then
    insert into public.profile(id, email)
      select id, email from auth.users where id = auth.uid()
      on conflict do nothing;
    select * into me from public.profile where id = auth.uid();
  end if;
  if me.id is null then return 0; end if;
  update public.profile set is_platform_admin = true
   where id = me.id and exists (select 1 from public.platform_admin_email p where p.email = me.email);
  insert into public.membership(tenant_id, user_id, role)
    select i.tenant_id, me.id, i.role from public.invite i
     where i.email = me.email and i.claimed_at is null
  on conflict (tenant_id, user_id) do nothing;
  get diagnostics n = row_count;
  update public.profile p set full_name = coalesce(p.full_name, i.full_name)
    from public.invite i where i.email = me.email and p.id = me.id and i.full_name is not null;
  update public.invite set claimed_at = now() where email = me.email and claimed_at is null;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Account ranking: base score × tenant targeting × account preference.
-- Nothing is deleted or hidden: excluded accounts stay visible with a reason, at the bottom.
-- ---------------------------------------------------------------------------
create or replace function app.cold_threshold_days(tier smallint) returns int language sql immutable as $$
  select case tier when 1 then 14 when 2 then 21 when 3 then 30 else 60 end
$$;

create or replace view public.account_ranked with (security_invoker = true) as
with base as (
  select a.*,
         m.slug as market_slug,
         (select count(*) from public.property p where p.account_id = a.id and not p.is_test) as property_count,
         (select count(*) from public.contact c where c.account_id = a.id and not c.is_test) as contact_count,
         (select count(*) from public.opportunity o where o.account_id = a.id and o.stage not in ('won','lost')) as open_opps,
         (select coalesce(sum(o.value_estimate),0) from public.opportunity o where o.account_id = a.id and o.stage not in ('won','lost')) as open_value,
         (select count(*) from public.task k where k.account_id = a.id and k.status = 'open') as open_tasks,
         pref.preference,
         pref.reason as preference_reason,
         extract(day from now() - a.last_touch_at)::int as days_since_touch
    from public.account a
    left join public.market m on m.id = a.market_id
    left join public.account_preference pref
           on pref.account_id = a.id and pref.tenant_id = a.tenant_id
          and (pref.expires_on is null or pref.expires_on >= current_date)
   where a.duplicate_of is null
), targeted as (
  select b.*,
         exists (select 1 from public.tenant_targeting tt where tt.tenant_id = b.tenant_id and tt.mode = 'exclude'
                  and ((tt.dimension = 'account_type' and tt.value = b.account_type)
                    or (tt.dimension = 'market' and tt.value = b.market_slug))) as target_excluded,
         coalesce((select exp(sum(ln(greatest(tt.weight, 0.0001))))::numeric from public.tenant_targeting tt
                    where tt.tenant_id = b.tenant_id and tt.mode = 'include'
                      and ((tt.dimension = 'account_type' and tt.value = b.account_type)
                        or (tt.dimension = 'market' and tt.value = b.market_slug))), 1.0) as target_weight
    from base b
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
-- The rep queue: what Today shows and what the Daily Brief ranks.
-- ---------------------------------------------------------------------------
create or replace function public.rep_queue(p_tenant uuid, p_user uuid, p_day date default null)
returns table (
  item_type text, task_id uuid, account_id uuid, contact_id uuid, opportunity_id uuid, property_id uuid,
  title text, reason text, due_on date, overdue_days int, score numeric,
  account_name text, contact_name text, phone text, email text, icp_tier smallint
) language sql stable as $$
  with d as (select coalesce(p_day, app.tenant_today(p_tenant)) as day)
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

-- ---------------------------------------------------------------------------
-- Streaks and leaderboard
-- ---------------------------------------------------------------------------
create or replace function public.close_rep_day(p_tenant uuid, p_day date) returns int language plpgsql security definer set search_path = public, app as $$
declare n int;
begin
  insert into public.rep_day as rd (tenant_id, user_id, day, touches, first_touches, in_person, points, tasks_completed, overdue_eod, cleared)
  select m.tenant_id, m.user_id, p_day,
         count(distinct t.id),
         count(distinct t.id) filter (where t.is_first_touch),
         count(distinct t.id) filter (where t.channel in ('door_knock','site_visit','inspection','roof_walk','lunch_and_learn','event','meeting')),
         coalesce((select sum(pe.points) from public.point_event pe where pe.tenant_id = m.tenant_id and pe.user_id = m.user_id
                    and not pe.voided and app.tenant_today(m.tenant_id, pe.occurred_at) = p_day), 0),
         (select count(*) from public.task k where k.tenant_id = m.tenant_id and k.assignee_user_id = m.user_id
           and k.status = 'done' and app.tenant_today(m.tenant_id, k.completed_at) = p_day),
         (select count(*) from public.task k where k.tenant_id = m.tenant_id and k.assignee_user_id = m.user_id
           and k.status = 'open' and k.due_on <= p_day),
         false
    from public.membership m
    left join public.touch t on t.tenant_id = m.tenant_id and t.user_id = m.user_id and t.voided_at is null
                            and app.tenant_today(m.tenant_id, t.occurred_at) = p_day
   where m.tenant_id = p_tenant and m.active
   group by m.tenant_id, m.user_id
  on conflict (tenant_id, user_id, day) do update set
    touches = excluded.touches, first_touches = excluded.first_touches, in_person = excluded.in_person,
    points = excluded.points, tasks_completed = excluded.tasks_completed, overdue_eod = excluded.overdue_eod;
  update public.rep_day set cleared = (overdue_eod = 0 and (touches > 0 or tasks_completed > 0))
   where tenant_id = p_tenant and day = p_day;
  get diagnostics n = row_count;
  return n;
end $$;

-- Streak = consecutive weekdays (most recent first) where the rep cleared their follow-ups.
create or replace function public.rep_streak(p_tenant uuid, p_user uuid) returns int language plpgsql stable as $$
declare d date := app.tenant_today(p_tenant) - 1; s int := 0; ok boolean;
begin
  if exists (select 1 from public.rep_day where tenant_id = p_tenant and user_id = p_user
              and day = app.tenant_today(p_tenant) and cleared) then s := 1; end if;
  loop
    while extract(isodow from d) >= 6 loop d := d - 1; end loop;
    select cleared into ok from public.rep_day where tenant_id = p_tenant and user_id = p_user and day = d;
    exit when not coalesce(ok, false);
    s := s + 1; d := d - 1;
    exit when s > 365;
  end loop;
  return s;
end $$;

create or replace function public.leaderboard(p_tenant uuid, p_since date)
returns table (user_id uuid, full_name text, role text, points bigint, touches bigint, connects bigint, in_person bigint)
language sql stable as $$
  select m.user_id, p.full_name, m.role,
         coalesce((select sum(pe.points) from public.point_event pe where pe.tenant_id = p_tenant and pe.user_id = m.user_id
                    and not pe.voided and pe.occurred_at >= p_since), 0),
         (select count(*) from public.touch t where t.tenant_id = p_tenant and t.user_id = m.user_id and t.voided_at is null and t.occurred_at >= p_since),
         (select count(*) from public.touch t where t.tenant_id = p_tenant and t.user_id = m.user_id and t.voided_at is null and t.occurred_at >= p_since
            and t.outcome in ('connected','met_in_person','met_decision_maker','replied','call_back_later')),
         (select count(*) from public.touch t where t.tenant_id = p_tenant and t.user_id = m.user_id and t.voided_at is null and t.occurred_at >= p_since
            and t.channel in ('door_knock','site_visit','inspection','roof_walk','lunch_and_learn','event','meeting'))
    from public.membership m join public.profile p on p.id = m.user_id
   where m.tenant_id = p_tenant and m.active
   order by 4 desc
$$;

-- Duplicate suggestions at insert time (the UI calls this before creating a contact/account).
create or replace function public.find_similar_contacts(p_tenant uuid, p_name text, p_email text, p_phone text)
returns table (id uuid, full_name text, email text, phone text, account_name text, similarity real)
language sql stable as $$
  select c.id, c.full_name, c.email::text, coalesce(c.mobile, c.phone), a.name,
         greatest(similarity(lower(coalesce(c.full_name,'')), lower(coalesce(p_name,''))),
                  case when p_email is not null and c.email = p_email::citext then 1 else 0 end,
                  case when p_phone is not null and regexp_replace(coalesce(c.phone,c.mobile,''),'\D','','g') = regexp_replace(p_phone,'\D','','g')
                            and length(regexp_replace(p_phone,'\D','','g')) >= 10 then 0.95 else 0 end)::real
    from public.contact c left join public.account a on a.id = c.account_id
   where c.tenant_id = p_tenant and c.duplicate_of is null
     and (lower(c.full_name) % lower(coalesce(p_name,'')) or c.email = p_email::citext
          or regexp_replace(coalesce(c.phone,c.mobile,''),'\D','','g') = regexp_replace(coalesce(p_phone,'x'),'\D','','g'))
   order by 6 desc limit 5
$$;
