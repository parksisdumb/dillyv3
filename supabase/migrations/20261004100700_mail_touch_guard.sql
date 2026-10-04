-- Dilly — touch trigger guard for synced mail (Gmail now, Outlook later). Additive (create or replace).
--
-- Starts from the latest definition of app.on_touch_insert (20261003000300_activity.sql — no later migration
-- redefines it). Changes, all limited to source in ('gmail','outlook'); every other source behaves exactly as before:
--   * Points: inbound synced mail awards nothing (a contact's reply is not the rep's work — V2 gave 'connect'
--     points for it). Outbound synced mail awards 'touch_logged' only (no connect / on-time / cold-rescue /
--     decision-maker points), and only when sent within the last 24 h, so the 30-day first-sync backfill doesn't
--     flood the leaderboard. Same-day repeat rule unchanged.
--   * An auto-reply / out-of-office or a bounce does not complete open follow-ups (the follow-up still needs
--     doing — by phone, or to another address). Freshness stamps and the contact's email_status='bounced' still apply.
--   * Replies still close the open follow-up and schedule "Respond to {contact}" (outcome_rule 'replied':
--     follow_up, 1 business day, priority 85).

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
  -- Mailbox sync (Gmail now, Outlook later): the rep didn't log it by hand.
  v_is_sync    boolean := new.source in ('gmail','outlook');
  -- An out-of-office or a bounce is not the follow-up getting done: it must not close the open task.
  v_sync_quiet boolean := new.source in ('gmail','outlook') and new.outcome in ('auto_reply','bounced');
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
       and not v_sync_quiet
       and ( (new.contact_id is not null and contact_id = new.contact_id)
          or (contact_id is null and v_account is not null and account_id = v_account) )
  loop
    update public.task set status = 'done', completed_at = new.occurred_at, completed_by_touch_id = new.id
     where id = v_task.id;
    -- On-time credit only for genuine follow-ups (scheduled on an earlier day), so same-day repeats can't farm it.
    if not v_is_import and not v_is_sync and new.user_id is not null and v_task.due_on >= v_today
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
  -- Synced mail: inbound (a reply, an auto-reply, a bounce) is not something the rep did -> nothing. Outbound earns
  -- touch_logged only, and only when it was sent in the last 24 h (the 30-day first-sync backfill scores nothing).
  if v_is_sync then
    if new.user_id is not null and new.direction = 'outbound' and new.occurred_at >= now() - interval '24 hours'
       and (new.contact_id is not null or v_account is not null) then
      select count(*) into v_prev_today from public.touch
       where tenant_id = new.tenant_id and user_id = new.user_id and id <> new.id and voided_at is null
         and coalesce(contact_id, '00000000-0000-0000-0000-000000000000') = coalesce(new.contact_id, '00000000-0000-0000-0000-000000000000')
         and coalesce(account_id, v_account) is not distinct from v_account
         and app.tenant_today(tenant_id, occurred_at) = v_today;
      if v_prev_today = 0 then
        perform app.award(new.tenant_id, new.user_id, 'touch_logged', new.id, null, new.opportunity_id, v_account, new.occurred_at);
      end if;
    end if;
  elsif new.user_id is not null and (new.contact_id is not null or v_account is not null) then
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
