-- Dilly — appointments: scheduled inspections, roof walks, meetings, lunch & learns… for one building or a series.
-- Additive only. Owner of this range: 20261004400000–20261004499999.
--
-- Model
--   appointment            one scheduled event (kind, starts_at/ends_at, assigned rep, status).
--   appointment_property   the buildings, in visiting order (a "series of apartments" is one appointment, N rows).
--   appointment_contact    who's attending.
--   appointment_change     audit of reschedules / status / reassignments (written by trigger, never by hand).
--   touch.appointment_id   touches logged as the outcome of an appointment.
--   point_event.appointment_id, task.appointment_id   points / the "Log outcome" task that belong to an appointment.
--
-- Rules (decided here, documented in docs/RUNBOOK.md §13)
--   * Creating an appointment logs no touch and creates no follow-up task.
--   * Completing = logging the outcome (public.log_appointment_outcome): one touch at the account, or — "log each
--     building" — one touch per building. Points and the next follow-up come from ONE touch (the outcome touch,
--     appointment.outcome_touch_id); the per-building touches are timeline records (their points are voided).
--   * Points for booking: an inspection / roof_walk appointment awards inspection_booked to whoever booked it, unless
--     (a) it was created from a logged "Booked inspection" touch (booked_touch_id: the touch already earned it), or
--     (b) that rep already holds a live inspection_booked for the same account that tenant-day. The same check runs
--     the other way: a "Booked inspection" touch logged after an appointment booking on the same account that day is
--     recorded voided. Canceling the appointment voids its booking points.
--   * The day after an appointment that still has no outcome, a task "Log outcome: {title}" appears
--     (public.appointment_outcome_tasks — run by Today and the 06:00 brief). Logging the outcome closes it; cancel /
--     no-show drops it.
--   * Scorecard: completed meeting / inspection / roof_walk appointments count as qualified meetings once each; their
--     outcome touches don't count again.

create table if not exists public.appointment (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenant(id) on delete cascade,
  kind              text not null default 'inspection'
                    check (kind in ('inspection','roof_walk','meeting','lunch_and_learn','site_visit','call','other')),
  title             text not null check (length(title) between 1 and 200),
  starts_at         timestamptz not null,
  ends_at           timestamptz,
  all_day           boolean not null default false,
  location          text,
  notes             text,
  account_id        uuid references public.account(id) on delete set null,
  opportunity_id    uuid references public.opportunity(id) on delete set null,
  assigned_user_id  uuid references public.profile(id) on delete set null,
  created_by        uuid references public.profile(id) on delete set null,
  status            text not null default 'scheduled' check (status in ('scheduled','done','canceled','no_show')),
  outcome_touch_id  uuid references public.touch(id) on delete set null,
  booked_touch_id   uuid references public.touch(id) on delete set null,
  reminder_minutes  int not null default 60 check (reminder_minutes between 0 and 1440),
  source            text not null default 'rep' check (source in ('rep','log','agent','import')),
  completed_at      timestamptz,
  canceled_at       timestamptz,
  cancel_reason     text,
  reschedule_count  int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint appointment_ends_after_start check (ends_at is null or ends_at >= starts_at)
);
create index if not exists appointment_user_time_idx on public.appointment(tenant_id, assigned_user_id, starts_at) where status = 'scheduled';
create index if not exists appointment_tenant_time_idx on public.appointment(tenant_id, starts_at);
create index if not exists appointment_account_idx on public.appointment(account_id) where account_id is not null;
create unique index if not exists appointment_booked_touch_uq on public.appointment(booked_touch_id) where booked_touch_id is not null;
drop trigger if exists appointment_updated on public.appointment;
create trigger appointment_updated before update on public.appointment for each row execute function app.touch_updated_at();

create table if not exists public.appointment_property (
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  appointment_id  uuid not null references public.appointment(id) on delete cascade,
  property_id     uuid not null references public.property(id) on delete cascade,
  sort            int not null default 0,
  primary key (appointment_id, property_id)
);
create index if not exists appointment_property_property_idx on public.appointment_property(property_id);

create table if not exists public.appointment_contact (
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  appointment_id  uuid not null references public.appointment(id) on delete cascade,
  contact_id      uuid not null references public.contact(id) on delete cascade,
  primary key (appointment_id, contact_id)
);
create index if not exists appointment_contact_contact_idx on public.appointment_contact(contact_id);

create table if not exists public.appointment_change (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  appointment_id  uuid not null references public.appointment(id) on delete cascade,
  field           text not null check (field in ('starts_at','status','assigned_user_id')),
  old_value       text,
  new_value       text,
  changed_by      uuid references public.profile(id) on delete set null,
  changed_at      timestamptz not null default now()
);
create index if not exists appointment_change_appt_idx on public.appointment_change(appointment_id, changed_at);

alter table public.touch       add column if not exists appointment_id uuid references public.appointment(id) on delete set null;
alter table public.point_event add column if not exists appointment_id uuid references public.appointment(id) on delete set null;
alter table public.task        add column if not exists appointment_id uuid references public.appointment(id) on delete set null;
create index if not exists touch_appointment_idx on public.touch(appointment_id) where appointment_id is not null;
create unique index if not exists point_event_appointment_once on public.point_event(appointment_id, event) where appointment_id is not null and touch_id is null;
-- One "Log outcome" task per appointment, ever (a dropped one isn't re-created).
create unique index if not exists task_appointment_uq on public.task(appointment_id) where appointment_id is not null;

-- ---------------------------------------------------------------------------
-- RLS — same fast pattern as 20261004000500_performance.sql (membership evaluated once per statement).
-- Everyone in the company can see and work appointments (like tasks); delete is owner/admin only (cancel instead).
-- appointment_change is written by trigger only.
-- ---------------------------------------------------------------------------
alter table public.appointment          enable row level security;
alter table public.appointment_property enable row level security;
alter table public.appointment_contact  enable row level security;
alter table public.appointment_change   enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['appointment','appointment_property','appointment_contact']) loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))
                      with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
  end loop;
end $$;
-- Removing a building / attendee from an appointment is normal editing; deleting the appointment itself is not.
drop policy if exists appointment_property_delete on public.appointment_property;
drop policy if exists appointment_contact_delete on public.appointment_contact;
drop policy if exists appointment_delete on public.appointment;
create policy appointment_property_delete on public.appointment_property for delete to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
create policy appointment_contact_delete on public.appointment_contact for delete to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
create policy appointment_delete on public.appointment for delete to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]));
drop policy if exists appointment_change_select on public.appointment_change;
create policy appointment_change_select on public.appointment_change for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));

grant select, insert, update, delete on public.appointment, public.appointment_property, public.appointment_contact to authenticated;
grant select on public.appointment_change to authenticated;
grant all on public.appointment, public.appointment_property, public.appointment_contact, public.appointment_change to service_role;

-- ---------------------------------------------------------------------------
-- Integrity: everything an appointment points at belongs to the same company (FKs don't know about tenants).
-- ---------------------------------------------------------------------------
create or replace function app.appointment_tenant_check() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.account_id is not null and not exists (select 1 from public.account where id = new.account_id and tenant_id = new.tenant_id) then
    raise exception 'account belongs to another company' using errcode = '23503';
  end if;
  if new.opportunity_id is not null and not exists (select 1 from public.opportunity where id = new.opportunity_id and tenant_id = new.tenant_id) then
    raise exception 'opportunity belongs to another company' using errcode = '23503';
  end if;
  if new.assigned_user_id is not null and new.assigned_user_id is distinct from (case when tg_op = 'UPDATE' then old.assigned_user_id end)
     and not exists (select 1 from public.membership where user_id = new.assigned_user_id and tenant_id = new.tenant_id and active) then
    raise exception 'assigned rep is not in this company' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.tenant_id <> old.tenant_id then
    raise exception 'an appointment cannot move between companies' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists appointment_tenant_check on public.appointment;
create trigger appointment_tenant_check before insert or update on public.appointment
  for each row execute function app.appointment_tenant_check();

create or replace function app.appointment_link_check() returns trigger language plpgsql security definer set search_path = public, app as $$
declare v_addr text;
begin
  if not exists (select 1 from public.appointment where id = new.appointment_id and tenant_id = new.tenant_id) then
    raise exception 'appointment belongs to another company' using errcode = '23503';
  end if;
  if tg_table_name = 'appointment_property' then
    if not exists (select 1 from public.property where id = new.property_id and tenant_id = new.tenant_id) then
      raise exception 'property belongs to another company' using errcode = '23503';
    end if;
    -- Location defaults from the first building's address.
    select nullif(concat_ws(', ', nullif(p.address1, ''), nullif(p.city, ''), nullif(p.state, '')), '') into v_addr
      from public.property p where p.id = new.property_id;
    if v_addr is not null then
      update public.appointment set location = v_addr
       where id = new.appointment_id and (location is null or location = '')
         and not exists (select 1 from public.appointment_property ap where ap.appointment_id = new.appointment_id and ap.sort < new.sort);
    end if;
  elsif not exists (select 1 from public.contact where id = new.contact_id and tenant_id = new.tenant_id) then
    raise exception 'contact belongs to another company' using errcode = '23503';
  end if;
  return new;
end $$;
drop trigger if exists appointment_property_check on public.appointment_property;
create trigger appointment_property_check before insert or update on public.appointment_property
  for each row execute function app.appointment_link_check();
drop trigger if exists appointment_contact_check on public.appointment_contact;
create trigger appointment_contact_check before insert or update on public.appointment_contact
  for each row execute function app.appointment_link_check();

-- ---------------------------------------------------------------------------
-- History: reschedules, status changes and reassignments are kept (appointment_change), plus reschedule_count.
-- ---------------------------------------------------------------------------
create or replace function app.appointment_before_update() returns trigger language plpgsql as $$
begin
  if new.starts_at is distinct from old.starts_at then
    new.reschedule_count := old.reschedule_count + 1;
    -- Moving a no-show (or a past one) to a new time puts it back on the schedule.
    if new.status = 'no_show' and old.status = 'no_show' then new.status := 'scheduled'; end if;
  end if;
  if new.status = 'done' and old.status <> 'done' then new.completed_at := coalesce(new.completed_at, now()); end if;
  if new.status = 'canceled' and old.status <> 'canceled' then new.canceled_at := coalesce(new.canceled_at, now()); end if;
  if new.status = 'scheduled' then new.canceled_at := null; new.cancel_reason := null; end if;
  return new;
end $$;
drop trigger if exists appointment_before_update on public.appointment;
create trigger appointment_before_update before update on public.appointment for each row execute function app.appointment_before_update();

create or replace function app.appointment_after_write() returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_user uuid := coalesce(auth.uid(), new.created_by);
  v_day  date;
begin
  if tg_op = 'INSERT' then
    -- Booking points (see header). Credited to whoever booked it.
    if new.kind in ('inspection','roof_walk') and new.booked_touch_id is null and new.source in ('rep','log')
       and new.created_by is not null and new.status = 'scheduled' then
      v_day := app.tenant_today(new.tenant_id, new.created_at);
      if not exists (
        select 1 from public.point_event pe
         where pe.tenant_id = new.tenant_id and pe.user_id = new.created_by and pe.event = 'inspection_booked' and not pe.voided
           and pe.account_id is not distinct from new.account_id and new.account_id is not null
           and app.tenant_today(pe.tenant_id, pe.occurred_at) = v_day) then
        insert into public.point_event(tenant_id, user_id, event, points, appointment_id, opportunity_id, account_id, occurred_at)
        select new.tenant_id, new.created_by, 'inspection_booked', p, new.id, new.opportunity_id, new.account_id, new.created_at
          from (select app.points_for(new.tenant_id, 'inspection_booked') as p) x where p > 0
        on conflict do nothing;
      end if;
    end if;
    -- Light pipeline automation, same as a "Booked inspection" touch.
    if new.opportunity_id is not null and new.kind in ('inspection','roof_walk') then
      update public.opportunity set stage = 'inspection_scheduled' where id = new.opportunity_id and stage in ('lead','contacted');
    end if;
    return new;
  end if;

  if new.starts_at is distinct from old.starts_at then
    insert into public.appointment_change(tenant_id, appointment_id, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.id, 'starts_at', old.starts_at::text, new.starts_at::text, v_user);
    -- Moved into the future: an outstanding "Log outcome" task no longer applies.
    if new.status = 'scheduled' and app.tenant_today(new.tenant_id, new.starts_at) >= app.tenant_today(new.tenant_id) then
      delete from public.task where appointment_id = new.id and status = 'open';
    end if;
  end if;
  if new.status is distinct from old.status then
    insert into public.appointment_change(tenant_id, appointment_id, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.id, 'status', old.status, new.status, v_user);
    if new.status in ('canceled','no_show') then
      update public.task set status = 'dropped' where appointment_id = new.id and status = 'open';
    end if;
    if new.status = 'canceled' then
      update public.point_event set voided = true where appointment_id = new.id and touch_id is null;
    elsif old.status = 'canceled' and new.status = 'scheduled' then
      update public.point_event set voided = false where appointment_id = new.id and touch_id is null;
    end if;
  end if;
  if new.assigned_user_id is distinct from old.assigned_user_id then
    insert into public.appointment_change(tenant_id, appointment_id, field, old_value, new_value, changed_by)
    values (new.tenant_id, new.id, 'assigned_user_id', old.assigned_user_id::text, new.assigned_user_id::text, v_user);
    update public.task set assignee_user_id = new.assigned_user_id where appointment_id = new.id and status = 'open';
  end if;
  return new;
end $$;
drop trigger if exists appointment_after_write on public.appointment;
create trigger appointment_after_write after insert or update on public.appointment
  for each row execute function app.appointment_after_write();

-- A "Booked inspection" touch on an account where the same rep already earned inspection_booked from an appointment
-- that day is recorded voided (no double points). Only applies when an appointment is on one side.
create or replace function app.point_event_dedupe_booking() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.event = 'inspection_booked' and new.touch_id is not null and new.account_id is not null and not new.voided
     and exists (
       select 1 from public.point_event pe
        where pe.tenant_id = new.tenant_id and pe.user_id = new.user_id and pe.event = 'inspection_booked' and not pe.voided
          and pe.appointment_id is not null and pe.touch_id is null and pe.account_id = new.account_id
          and app.tenant_today(pe.tenant_id, pe.occurred_at) = app.tenant_today(new.tenant_id, new.occurred_at)) then
    new.voided := true;
  end if;
  return new;
end $$;
drop trigger if exists point_event_dedupe_booking on public.point_event;
create trigger point_event_dedupe_booking before insert on public.point_event
  for each row execute function app.point_event_dedupe_booking();

-- ---------------------------------------------------------------------------
-- Completing: log the outcome. One RPC = one transaction. SECURITY DEFINER (it voids the per-building touches'
-- points), so it checks membership itself and always logs as auth.uid(). Idempotent: a repeat call (offline replay,
-- double tap) returns the outcome touch already recorded.
-- ---------------------------------------------------------------------------
create or replace function public.log_appointment_outcome(
  p_appointment     uuid,
  p_channel         text,
  p_outcome         text,
  p_contact         uuid default null,
  p_met_role        text default null,
  p_notes           text default null,
  p_each_building   boolean default false,
  p_external_id     text default null,
  p_media           jsonb default '[]'::jsonb,
  p_occurred_at     timestamptz default null,
  p_follow_up_on    date default null,
  p_follow_up_note  text default null,
  p_skip_follow_up  boolean default false,
  p_source          text default 'rep',
  p_opportunity     uuid default null
) returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  a        public.appointment;
  v_at     timestamptz := coalesce(p_occurred_at, now());
  v_main   uuid;
  v_props  uuid[];
  v_extra  uuid[] := '{}';
  v_id     uuid;
  i        int;
begin
  select * into a from public.appointment where id = p_appointment for update;
  if not found or (auth.uid() is not null and not (a.tenant_id = any (app.my_tenant_ids()))) then
    raise exception 'appointment not found' using errcode = 'P0002';
  end if;
  if p_source not in ('rep','field') then raise exception 'bad source' using errcode = '22023'; end if;
  if a.outcome_touch_id is not null then return a.outcome_touch_id; end if;
  if p_external_id is not null then
    select id into v_main from public.touch where tenant_id = a.tenant_id and source = p_source and external_id = p_external_id;
    if v_main is not null then return v_main; end if;
  end if;
  if a.status = 'canceled' then raise exception 'this appointment was canceled' using errcode = '22023'; end if;

  select coalesce(array_agg(property_id order by sort, property_id), '{}') into v_props
    from public.appointment_property where appointment_id = a.id;

  insert into public.touch(tenant_id, user_id, account_id, contact_id, property_id, opportunity_id, channel, outcome, met_role,
                           notes, follow_up_on, follow_up_note, skip_follow_up, source, external_id, media, occurred_at, appointment_id)
  values (a.tenant_id, auth.uid(),
          coalesce(a.account_id, (select account_id from public.property where id = v_props[1])),
          p_contact,
          case when p_each_building or cardinality(v_props) = 1 then v_props[1] end,
          coalesce(p_opportunity, a.opportunity_id),
          p_channel, p_outcome, p_met_role, nullif(p_notes, ''), p_follow_up_on, nullif(p_follow_up_note, ''), coalesce(p_skip_follow_up, false),
          p_source, p_external_id, coalesce(p_media, '[]'::jsonb), v_at, a.id)
  returning id into v_main;

  -- Every other building gets its own timeline entry: a millisecond earlier each (so they never close the follow-up
  -- the outcome touch just scheduled), no follow-up, no points.
  if p_each_building and cardinality(v_props) > 1 then
    for i in 2..cardinality(v_props) loop
      insert into public.touch(tenant_id, user_id, account_id, contact_id, property_id, opportunity_id, channel, outcome, met_role,
                               notes, skip_follow_up, source, external_id, occurred_at, appointment_id)
      values (a.tenant_id, auth.uid(),
              coalesce((select account_id from public.property where id = v_props[i]), a.account_id),
              p_contact, v_props[i], coalesce(p_opportunity, a.opportunity_id), p_channel, p_outcome, p_met_role, nullif(p_notes, ''), true,
              p_source, case when p_external_id is not null then p_external_id || ':' || i end,
              v_at - make_interval(secs => (i - 1) / 1000.0), a.id)
      returning id into v_id;
      v_extra := v_extra || v_id;
    end loop;
    update public.point_event set voided = true where touch_id = any(v_extra);
  end if;

  update public.appointment set status = 'done', outcome_touch_id = v_main, completed_at = v_at where id = a.id;
  update public.task set status = 'done', completed_at = v_at, completed_by_touch_id = v_main
   where appointment_id = a.id and status = 'open';
  return v_main;
end $$;
revoke execute on function public.log_appointment_outcome(uuid, text, text, uuid, text, text, boolean, text, jsonb, timestamptz, date, text, boolean, text, uuid) from public, anon;
grant execute on function public.log_appointment_outcome(uuid, text, text, uuid, text, text, boolean, text, jsonb, timestamptz, date, text, boolean, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- "Log outcome: {title}" — the day after an appointment that still has no outcome. Idempotent (task_appointment_uq);
-- looks back 30 days. SECURITY INVOKER: a rep running it (Today) creates tasks only in their own company.
-- ---------------------------------------------------------------------------
create or replace function public.appointment_outcome_tasks(p_tenant uuid) returns int language plpgsql set search_path = public, app as $$
declare n int;
begin
  insert into public.task(tenant_id, assignee_user_id, account_id, property_id, opportunity_id, kind, title, reason,
                          due_on, priority, source, created_by, appointment_id)
  select a.tenant_id, a.assigned_user_id, a.account_id,
         (select ap.property_id from public.appointment_property ap where ap.appointment_id = a.id order by ap.sort limit 1),
         a.opportunity_id, 'custom', left('Log outcome: ' || a.title, 200),
         'Appointment ' || to_char(a.starts_at at time zone coalesce(t.timezone, 'America/Chicago'), 'Mon DD') || ' has no outcome yet',
         app.tenant_today(a.tenant_id), 80, 'rule', a.created_by, a.id
    from public.appointment a
    join public.tenant t on t.id = a.tenant_id
   where a.tenant_id = p_tenant and a.status = 'scheduled' and a.assigned_user_id is not null
     and app.tenant_today(a.tenant_id, coalesce(a.ends_at, a.starts_at)) < app.tenant_today(a.tenant_id)
     and a.starts_at > now() - interval '30 days'
     and not exists (select 1 from public.task k where k.appointment_id = a.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.appointment_outcome_tasks(uuid) from public, anon;
grant execute on function public.appointment_outcome_tasks(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Scorecard: identical to 20261004200000_import_assign_scorecard.sql except
--   meetings += completed meeting / inspection / roof_walk appointments (assigned rep, on the appointment's date),
--               where someone was met (the outcome isn't not_there / no_answer / …);
--   and the outcome touches of those appointments don't count a second time.
-- ---------------------------------------------------------------------------
create or replace function public.team_scorecard(p_tenant uuid, p_weeks int default 13)
returns table (user_id uuid, bucket text, period_start date, meetings int, in_person int, first_touches int, fu_due int, fu_done int, paperwork int)
language sql stable as $$
  with p as materialized (
    select x.tz, x.today,
           (date_trunc('week', x.today)::date - 7 * (greatest(coalesce(p_weeks, 13), 1) - 1)) as w0,
           (date_trunc('month', x.today) - interval '1 month')::date as m0
      from (select coalesce((select t.timezone from public.tenant t where t.id = p_tenant), 'America/Chicago') as tz,
                   app.tenant_today(p_tenant) as today) x
  ), lo as materialized (
    select p.tz, p.today, p.w0, p.m0, least(p.w0, p.m0) as d0, (least(p.w0, p.m0)::timestamp at time zone p.tz) as ts0 from p
  ), ev as (
    select x.user_id as uid, (x.occurred_at at time zone lo.tz)::date as d,
           ((x.outcome in ('scheduled_inspection','met_decision_maker')
             or (x.channel in ('meeting','roof_walk','inspection')
                 and x.outcome not in ('not_there','no_answer','voicemail','gatekeeper','not_interested','bounced','auto_reply')))
            and (x.appointment_id is null or not exists (select 1 from public.appointment ap
                             where ap.id = x.appointment_id and ap.status = 'done' and ap.kind in ('meeting','inspection','roof_walk'))))::int as meetings,
           (x.channel in ('door_knock','site_visit','inspection','roof_walk','lunch_and_learn','event','meeting'))::int as in_person,
           x.is_first_touch::int as first_touches, 0 as fu_due, 0 as fu_done, 0 as paperwork
      from public.touch x cross join lo
     where x.tenant_id = p_tenant and x.voided_at is null and x.user_id is not null and x.occurred_at >= lo.ts0
    union all
    select a.assigned_user_id, (a.starts_at at time zone lo.tz)::date, 1, 0, 0, 0, 0, 0
      from public.appointment a cross join lo
      left join public.touch o on o.id = a.outcome_touch_id
     where a.tenant_id = p_tenant and a.status = 'done' and a.kind in ('meeting','inspection','roof_walk')
       and a.assigned_user_id is not null and a.starts_at >= lo.ts0
       and coalesce(o.outcome, 'met_in_person') not in ('not_there','no_answer','voicemail','gatekeeper','not_interested','bounced','auto_reply')
    union all
    select k.assignee_user_id, k.due_on, 0, 0, 0, 1, (k.status = 'done')::int, 0
      from public.task k cross join lo
     where k.tenant_id = p_tenant and k.status <> 'dropped' and k.assignee_user_id is not null
       and k.due_on >= lo.d0 and k.due_on <= lo.today
    union all
    select a.owner_user_id, (a.paperwork_at at time zone lo.tz)::date, 0, 0, 0, 0, 0, 1
      from public.account a cross join lo
     where a.tenant_id = p_tenant and a.paperwork_at >= lo.ts0 and not a.is_test and a.duplicate_of is null
  )
  select e.uid, 'week', date_trunc('week', e.d)::date,
         sum(e.meetings)::int, sum(e.in_person)::int, sum(e.first_touches)::int, sum(e.fu_due)::int, sum(e.fu_done)::int, sum(e.paperwork)::int
    from ev e cross join lo where e.d >= lo.w0 group by 1, 3
  union all
  select e.uid, 'month', date_trunc('month', e.d)::date,
         sum(e.meetings)::int, sum(e.in_person)::int, sum(e.first_touches)::int, sum(e.fu_due)::int, sum(e.fu_done)::int, sum(e.paperwork)::int
    from ev e cross join lo where e.d >= lo.m0 group by 1, 3
$$;
grant execute on function public.team_scorecard(uuid, int) to authenticated, service_role;
