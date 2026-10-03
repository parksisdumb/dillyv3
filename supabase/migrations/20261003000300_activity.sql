-- Dilly — activity: the touch ledger, tasks (follow-ups / next steps), and the rules that connect them.
--
-- THE RULE THAT FIXES DILLY V2's 0% FOLLOW-UP COMPLETION:
--   any touch on a contact (or, for account-level touches, on the account) completes that contact's /
--   account's open follow-up tasks, then schedules the next task from the outcome table.
-- It lives in a trigger so it holds for every source: rep log, field capture, Gmail/Outlook sync, agents.

create table public.touch (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  occurred_at     timestamptz not null default now(),
  user_id         uuid references public.profile(id),          -- the rep (null for system/agent-only)
  account_id      uuid references public.account(id) on delete set null,
  contact_id      uuid references public.contact(id) on delete set null,
  property_id     uuid references public.property(id) on delete set null,
  opportunity_id  uuid references public.opportunity(id) on delete set null,
  channel         app.channel not null,
  direction       text not null default 'outbound' check (direction in ('outbound','inbound')),
  outcome         app.outcome not null,
  met_role        app.persona_role,                           -- who the rep actually reached
  notes           text,
  follow_up_on    date,                                        -- rep override for the next task's due date
  follow_up_note  text,
  skip_follow_up  boolean not null default false,
  is_first_touch  boolean not null default false,              -- set by trigger: first touch ever on this account
  source          text not null default 'rep' check (source in ('rep','field','gmail','outlook','agent','import','dillyv2')),
  external_id     text,                                        -- e.g. Gmail message id
  agent_run_id    uuid,
  media           jsonb not null default '[]'::jsonb,          -- photo/voice storage paths
  legacy_table    text,
  legacy_id       text,
  voided_at       timestamptz,
  voided_by       uuid references public.profile(id),
  void_reason     text,
  created_at      timestamptz not null default now()
);
create unique index touch_legacy_uq   on public.touch(tenant_id, legacy_table, legacy_id) where legacy_id is not null;
create unique index touch_external_uq on public.touch(tenant_id, source, external_id) where external_id is not null;
create index touch_account_idx on public.touch(account_id, occurred_at desc);
create index touch_contact_idx on public.touch(contact_id, occurred_at desc);
create index touch_user_idx    on public.touch(tenant_id, user_id, occurred_at desc);

-- The ledger is append-only. Only void fields may change.
create or replace function app.touch_guard() returns trigger language plpgsql as $$
begin
  if (new.tenant_id, new.occurred_at, new.user_id, new.account_id, new.contact_id, new.property_id, new.opportunity_id,
      new.channel, new.direction, new.outcome, new.source, new.external_id)
     is distinct from
     (old.tenant_id, old.occurred_at, old.user_id, old.account_id, old.contact_id, old.property_id, old.opportunity_id,
      old.channel, old.direction, old.outcome, old.source, old.external_id) then
    raise exception 'touch ledger is append-only; void and re-log instead';
  end if;
  return new;
end $$;
create trigger touch_guard before update on public.touch for each row execute function app.touch_guard();

-- ---------------------------------------------------------------------------
create table public.task (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenant(id) on delete cascade,
  assignee_user_id       uuid references public.profile(id),
  account_id             uuid references public.account(id) on delete cascade,
  contact_id             uuid references public.contact(id) on delete cascade,
  property_id            uuid references public.property(id) on delete set null,
  opportunity_id         uuid references public.opportunity(id) on delete cascade,
  kind                   text not null default 'follow_up' check (kind in ('follow_up','first_touch','next_step','inspection','proposal','onboarding','revisit','try_other_contact','custom')),
  title                  text not null,
  reason                 text,                     -- the one-line "why" shown in the queue
  due_on                 date not null,
  status                 text not null default 'open' check (status in ('open','done','dropped')),
  priority               smallint not null default 50 check (priority between 0 and 100),
  snooze_count           smallint not null default 0,
  completed_at           timestamptz,
  completed_by_touch_id  uuid references public.touch(id) on delete set null,
  created_from_touch_id  uuid references public.touch(id) on delete set null,
  source                 text not null default 'rule' check (source in ('rule','rep','agent','dillyv2','import')),
  legacy_table           text,
  legacy_id              text,
  created_by             uuid references public.profile(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index task_legacy_uq on public.task(tenant_id, legacy_table, legacy_id) where legacy_id is not null;
create index task_queue_idx   on public.task(tenant_id, assignee_user_id, status, due_on);
create index task_contact_idx on public.task(contact_id) where status = 'open';
create index task_account_idx on public.task(account_id) where status = 'open';
create trigger task_updated before update on public.task for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Outcome → next task. tenant_id null = platform default; a tenant row overrides.
-- ---------------------------------------------------------------------------
create table public.outcome_rule (
  tenant_id        uuid references public.tenant(id) on delete cascade,
  outcome          app.outcome not null,
  next_kind        text,               -- null = no follow-up
  business_days    int,
  title_template   text,               -- {contact} {account}
  priority         smallint not null default 50,
  contact_level    boolean not null default true,  -- false = account-level task (e.g. try another contact)
  unique nulls not distinct (tenant_id, outcome)
);

create or replace function app.rule_for(t uuid, o text) returns public.outcome_rule language sql stable as $$
  select r.* from public.outcome_rule r
  where r.outcome = o and (r.tenant_id = t or r.tenant_id is null)
  order by r.tenant_id nulls last limit 1
$$;

create or replace function app.tenant_today(t uuid, ts timestamptz default now()) returns date language sql stable as $$
  select (ts at time zone coalesce((select timezone from public.tenant where id = t), 'America/Chicago'))::date
$$;

-- ---------------------------------------------------------------------------
-- Points (gamification v2). Ledger of point events; rules overridable per tenant.
-- ---------------------------------------------------------------------------
create table public.point_rule (
  tenant_id  uuid references public.tenant(id) on delete cascade,
  event      text not null,
  points     int not null,
  label      text not null,
  unique nulls not distinct (tenant_id, event)
);

create table public.point_event (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant(id) on delete cascade,
  user_id        uuid not null references public.profile(id) on delete cascade,
  event          text not null,
  points         int not null,
  touch_id       uuid references public.touch(id) on delete cascade,
  task_id        uuid references public.task(id) on delete set null,
  opportunity_id uuid references public.opportunity(id) on delete set null,
  account_id     uuid references public.account(id) on delete set null,
  occurred_at    timestamptz not null default now(),
  voided         boolean not null default false
);
create index point_event_user_idx on public.point_event(tenant_id, user_id, occurred_at desc);
create unique index point_event_once on public.point_event(touch_id, event) where touch_id is not null;

create or replace function app.points_for(t uuid, e text) returns int language sql stable as $$
  select coalesce((select points from public.point_rule where event = e and (tenant_id = t or tenant_id is null)
                   order by tenant_id nulls last limit 1), 0)
$$;

create or replace function app.award(t uuid, u uuid, e text, touch uuid, task uuid, opp uuid, acct uuid, at timestamptz)
returns void language plpgsql as $$
declare p int := app.points_for(t, e);
begin
  if u is null or p = 0 then return; end if;
  insert into public.point_event(tenant_id,user_id,event,points,touch_id,task_id,opportunity_id,account_id,occurred_at)
  values (t,u,e,p,touch,task,opp,acct,coalesce(at,now()))
  on conflict do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- The touch trigger.
-- ---------------------------------------------------------------------------
create or replace function app.on_touch_insert() returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  r            public.outcome_rule;
  v_account    uuid := new.account_id;
  v_today      date := app.tenant_today(new.tenant_id, new.occurred_at);
  v_due        date;
  v_task       record;
  v_name       text;
  v_acct_name  text;
  v_prev_today int;
  v_was_cold   boolean;
  v_tier       smallint;
  v_is_import  boolean := new.source in ('dillyv2','import');
begin
  -- 1) Freshness stamps + cold-rescue detection.
  if v_account is not null then
    select icp_tier,
           last_touch_at is not null and new.occurred_at - last_touch_at >
             (case icp_tier when 1 then interval '14 days' when 2 then interval '21 days' when 3 then interval '30 days' else interval '60 days' end),
           name
      into v_tier, v_was_cold, v_acct_name
      from public.account where id = v_account;
    update public.account
       set last_touch_at  = greatest(coalesce(last_touch_at, new.occurred_at), new.occurred_at),
           first_touch_at = least(coalesce(first_touch_at, new.occurred_at), new.occurred_at)
     where id = v_account;
  end if;
  if new.contact_id is not null then
    update public.contact
       set last_touch_at = greatest(coalesce(last_touch_at, new.occurred_at), new.occurred_at),
           email_status  = case when new.outcome = 'bounced' then 'bounced' else email_status end
     where id = new.contact_id;
  end if;

  -- 2) Auto-complete open follow-ups this touch satisfies (any assignee: the work got done).
  for v_task in
    select id, assignee_user_id, due_on, created_at from public.task
     where tenant_id = new.tenant_id and status = 'open'
       and kind in ('follow_up','first_touch','revisit','try_other_contact','next_step')
       and created_at <= new.occurred_at
       and ( (new.contact_id is not null and contact_id = new.contact_id)
          or (contact_id is null and v_account is not null and account_id = v_account) )
  loop
    update public.task set status = 'done', completed_at = new.occurred_at, completed_by_touch_id = new.id
     where id = v_task.id;
    -- On-time credit only for genuine follow-ups (scheduled on an earlier day), so same-day repeats can't farm it.
    if not v_is_import and new.user_id is not null and v_task.due_on >= v_today
       and app.tenant_today(new.tenant_id, v_task.created_at) < v_today then
      perform app.award(new.tenant_id, new.user_id, 'follow_up_on_time', new.id, v_task.id, null, v_account, new.occurred_at);
    end if;
  end loop;

  if v_is_import then return new; end if;   -- migrated history: stamps + completion only, no new tasks/points

  -- 3) Schedule the next task.
  if not new.skip_follow_up and new.outcome not in ('bounced','auto_reply') then
    r := app.rule_for(new.tenant_id, new.outcome);
    if new.follow_up_on is not null or (r.next_kind is not null and r.business_days is not null) then
      v_due := coalesce(new.follow_up_on, app.add_business_days(v_today, r.business_days));
      select coalesce(full_name, 'contact') into v_name from public.contact where id = new.contact_id;
      insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, property_id, opportunity_id,
                              kind, title, reason, due_on, priority, created_from_touch_id, source, created_by, created_at)
      values (new.tenant_id, new.user_id, v_account,
              case when coalesce(r.contact_level, true) then new.contact_id else null end,
              new.property_id, new.opportunity_id,
              coalesce(r.next_kind, 'follow_up'),
              coalesce(new.follow_up_note,
                       replace(replace(coalesce(r.title_template, 'Follow up with {contact}'), '{contact}', coalesce(v_name,'contact')),
                               '{account}', coalesce(v_acct_name,'account'))),
              'After ' || replace(new.outcome::text, '_', ' ') || ' (' || replace(new.channel::text,'_',' ') || ') on ' || to_char(v_today, 'Mon DD'),
              v_due, coalesce(r.priority, 50), new.id, 'rule', new.user_id, new.occurred_at);
    end if;
  end if;

  -- 4) Points. No contact + no account = no points (anti-gaming); repeat touches on the same contact the same day score 0.
  if new.user_id is not null and (new.contact_id is not null or v_account is not null) then
    select count(*) into v_prev_today from public.touch
     where tenant_id = new.tenant_id and user_id = new.user_id and id <> new.id and voided_at is null
       and coalesce(contact_id, '00000000-0000-0000-0000-000000000000') = coalesce(new.contact_id, '00000000-0000-0000-0000-000000000000')
       and coalesce(account_id, v_account) is not distinct from v_account
       and app.tenant_today(tenant_id, occurred_at) = v_today;
    if v_prev_today = 0 then
      perform app.award(new.tenant_id, new.user_id, 'touch_logged', new.id, null, new.opportunity_id, v_account, new.occurred_at);
      if new.outcome in ('connected','met_in_person','met_decision_maker','replied','call_back_later') then
        perform app.award(new.tenant_id, new.user_id, 'connect', new.id, null, new.opportunity_id, v_account, new.occurred_at);
      end if;
      if new.met_role in ('economic_buyer','evaluator') or new.outcome = 'met_decision_maker' then
        perform app.award(new.tenant_id, new.user_id, 'decision_maker_conversation', new.id, null, new.opportunity_id, v_account, new.occurred_at);
      end if;
    end if;
    if new.outcome = 'scheduled_inspection' then
      perform app.award(new.tenant_id, new.user_id, 'inspection_booked', new.id, null, new.opportunity_id, v_account, new.occurred_at);
    end if;
    if new.channel in ('inspection','roof_walk') and new.outcome in ('met_in_person','connected','met_decision_maker','other')
       and jsonb_array_length(new.media) > 0 then
      perform app.award(new.tenant_id, new.user_id, 'site_walk_completed', new.id, null, new.opportunity_id, v_account, new.occurred_at);
    end if;
    if new.outcome = 'bid_requested' then
      perform app.award(new.tenant_id, new.user_id, 'bid_requested', new.id, null, new.opportunity_id, v_account, new.occurred_at);
    end if;
    if new.channel = 'lunch_and_learn' then
      perform app.award(new.tenant_id, new.user_id, 'lunch_and_learn', new.id, null, new.opportunity_id, v_account, new.occurred_at);
    end if;
    if coalesce(v_was_cold, false) and v_tier <= 2 then
      perform app.award(new.tenant_id, new.user_id, 'cold_rescued', new.id, null, null, v_account, new.occurred_at);
    end if;
  end if;

  -- 5) Light pipeline automation.
  if new.opportunity_id is not null then
    update public.opportunity set stage = 'inspection_scheduled'
     where id = new.opportunity_id and new.outcome = 'scheduled_inspection' and stage in ('lead','contacted');
    update public.opportunity set stage = 'contacted'
     where id = new.opportunity_id and stage = 'lead';
  end if;
  if v_account is not null then
    update public.account set onboarding_status = 'initial_touch'
     where id = v_account and onboarding_status = 'none';
  end if;

  return new;
end $$;

create trigger touch_after_insert after insert on public.touch for each row execute function app.on_touch_insert();

-- Before insert: fill account from contact/property when the rep only picked a person or a building,
-- and flag the first touch ever on the account. Both become part of the immutable row.
create or replace function app.touch_first_flag() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.account_id is null and new.contact_id is not null then
    select account_id into new.account_id from public.contact where id = new.contact_id;
  end if;
  if new.account_id is null and new.property_id is not null then
    select account_id into new.account_id from public.property where id = new.property_id;
  end if;
  if new.account_id is not null and not exists (
       select 1 from public.touch t where t.account_id = new.account_id and t.voided_at is null) then
    new.is_first_touch := true;
  end if;
  return new;
end $$;
create trigger touch_before_insert before insert on public.touch for each row execute function app.touch_first_flag();

-- Points that come from state changes rather than touches.
create or replace function app.on_opportunity_change() returns trigger language plpgsql security definer set search_path = public, app as $$
declare u uuid := coalesce(new.owner_user_id, new.created_by);
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage and new.source <> 'dillyv2' then
    if new.stage = 'proposal_sent' then
      perform app.award(new.tenant_id, u, 'proposal_delivered', null, null, new.id, new.account_id, now());
    elsif new.stage = 'won' then
      perform app.award(new.tenant_id, u, 'won', null, null, new.id, new.account_id, now());
    end if;
  end if;
  -- Every open opportunity carries a next step; create one if the rep didn't.
  if new.stage not in ('won','lost') and new.next_step_due is not null and
     (tg_op = 'INSERT' or new.next_step_due is distinct from old.next_step_due or new.next_step is distinct from old.next_step) then
    update public.task set status = 'dropped' where opportunity_id = new.id and kind = 'next_step' and status = 'open';
    insert into public.task(tenant_id, assignee_user_id, account_id, property_id, opportunity_id, kind, title, reason, due_on, priority, source, created_by)
    values (new.tenant_id, u, new.account_id, new.property_id, new.id, 'next_step',
            coalesce(new.next_step, 'Next step: ' || new.name), 'Open ' || replace(new.stage::text,'_',' ') || ' — ' || new.name,
            new.next_step_due, 70, 'rule', u);
  end if;
  return new;
end $$;
create trigger opportunity_after after insert or update on public.opportunity for each row execute function app.on_opportunity_change();

create or replace function app.on_account_onboarding() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.onboarding_status is distinct from old.onboarding_status
     and new.onboarding_status in ('paperwork_started','paperwork_received','paperwork_finished','compliant')
     and new.source <> 'dillyv2' then
    perform app.award(new.tenant_id, coalesce(auth.uid(), new.owner_user_id), 'onboarding_step', null, null, null, new.id, now());
  end if;
  return new;
end $$;
create trigger account_onboarding after update of onboarding_status on public.account for each row execute function app.on_account_onboarding();

-- After a bulk import (Dilly V2 migration), close every open task whose contact/account already has a later touch.
create or replace function app.reconcile_tasks(t uuid) returns int language plpgsql security definer set search_path = public, app as $$
declare n int;
begin
  with done as (
    select k.id, (select x.id from public.touch x
                   where x.tenant_id = t and x.voided_at is null and x.occurred_at >= k.created_at
                     and ((k.contact_id is not null and x.contact_id = k.contact_id)
                       or (k.contact_id is null and x.account_id = k.account_id))
                   order by x.occurred_at limit 1) as touch_id
      from public.task k where k.tenant_id = t and k.status = 'open'
  )
  update public.task k set status = 'done', completed_by_touch_id = d.touch_id,
         completed_at = (select occurred_at from public.touch where id = d.touch_id)
    from done d where d.id = k.id and d.touch_id is not null;
  get diagnostics n = row_count;
  return n;
end $$;
