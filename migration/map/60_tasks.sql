-- 60_tasks.sql — legacy_v.follow_ups -> public.task (kind follow_up). Idempotent.
-- Overdue follow-ups migrate as overdue, with their ORIGINAL created_at (app.reconcile_tasks in 90_post compares it
-- to touch times and closes every one that already has a later touch on the same contact/account).
-- A re-run never re-opens a task the new system already closed. V2 notes go to task.reason verbatim.

insert into public.task as k (
  tenant_id, assignee_user_id, account_id, contact_id, property_id, kind, title, reason, due_on, status, snooze_count,
  completed_at, created_from_touch_id, source, legacy_table, legacy_id, created_by, created_at, updated_at)
select migration.tenant_id(),
       migration.uid(f.assignee_legacy_user_id),
       coalesce(acc.id, con.account_id),
       con.id,
       prop.id,
       'follow_up',
       coalesce(nullif(btrim(f.title), ''), 'Follow up' || coalesce(' with ' || con.full_name, '')),
       coalesce(f.notes, 'Dilly V2 follow-up'),
       coalesce(f.due_on, f.created_at::date, current_date),
       migration.map('task_status', f.status),
       least(coalesce(f.snooze_count, 0), 32767)::smallint,
       case when migration.map('task_status', f.status) = 'done' then coalesce(f.completed_at, f.updated_at) end,
       tch.id,
       'dillyv2', f.legacy_table, f.legacy_id,
       migration.uid(f.assignee_legacy_user_id),
       coalesce(f.created_at, now()), coalesce(f.updated_at, f.created_at, now())
  from legacy_v.follow_ups f
  left join public.account  acc  on acc.tenant_id  = migration.tenant_id() and acc.legacy_table  = migration.lt('accounts')    and acc.legacy_id  = f.account_legacy_id
  left join public.contact  con  on con.tenant_id  = migration.tenant_id() and con.legacy_table  = migration.lt('contacts')    and con.legacy_id  = f.contact_legacy_id
  left join public.property prop on prop.tenant_id = migration.tenant_id() and prop.legacy_table = migration.lt('properties')  and prop.legacy_id = f.property_legacy_id
  left join public.touch    tch  on tch.tenant_id  = migration.tenant_id() and tch.legacy_table  = migration.lt('touchpoints') and tch.legacy_id  = f.touchpoint_legacy_id
 where migration.in_scope(f.org_id)
 order by f.created_at nulls last, f.legacy_id
on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
  assignee_user_id = coalesce(excluded.assignee_user_id, k.assignee_user_id),
  account_id       = excluded.account_id,
  contact_id       = excluded.contact_id,
  property_id      = excluded.property_id,
  title            = excluded.title,
  reason           = excluded.reason,
  due_on           = excluded.due_on,
  -- the new system's closure wins; a V2 completion/dismissal after the snapshot (delta) still lands
  status           = case when k.status = 'open' then excluded.status else k.status end,
  completed_at     = case when k.status = 'open' then excluded.completed_at else k.completed_at end,
  snooze_count     = excluded.snooze_count,
  created_from_touch_id = excluded.created_from_touch_id,
  created_at       = excluded.created_at;

insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
select migration.tenant_id(), 'task', k.id, f.legacy_table, f.legacy_id, 'legacy_status', f.status
  from legacy_v.follow_ups f
  join public.task k on k.tenant_id = migration.tenant_id() and k.legacy_table = f.legacy_table and k.legacy_id = f.legacy_id
 where migration.in_scope(f.org_id) and f.status is not null
on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), f.legacy_table, f.legacy_id, f2.flag, f2.detail
  from legacy_v.follow_ups f
  left join public.contact con on con.tenant_id = migration.tenant_id() and con.legacy_table = migration.lt('contacts') and con.legacy_id = f.contact_legacy_id
  cross join lateral (values
    (case when migration.looks_test(f.title, f.notes) then 'test_row' end, f.title),
    (case when f.due_on is null then 'missing_due_date' end, 'due date set to created date'),
    (case when f.contact_legacy_id is not null and con.id is null then 'orphan' end, 'contact ' || f.contact_legacy_id || ' missing')) f2(flag, detail)
 where migration.in_scope(f.org_id) and f2.flag is not null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

select migration.note_actors('follow_ups', 'assignee_legacy_user_id', 'assignee');
