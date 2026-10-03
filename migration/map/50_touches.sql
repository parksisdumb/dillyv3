-- 50_touches.sql — legacy_v.touchpoints -> public.touch (the append-only ledger). Idempotent.
--
-- source = 'dillyv2': the touch trigger only stamps account/contact freshness and closes open tasks — it creates
-- no new tasks and awards no points (migrated history). Inserted in time order so is_first_touch is right.
-- Gmail-sourced touches keep their message id as external_id 'gmail:<id>' (first row per message id; later
-- duplicates are flagged and keep their id in migration.legacy_value). Provenance (manual/gmail) and V2 points are
-- kept in migration.legacy_value.
-- The ledger is append-only: a re-run only refreshes notes. If V2 changed a touch's type/outcome/time after the
-- first load, reconcile's touch_fields check FAILs and lists it (void + re-log in the new app; never edit the ledger).
-- Unknown reps: user_id stays null, the V2 actor is kept in migration.unmapped_actor (see 95_reattribute.sql).

with src as (
  select t.*,
         row_number() over (partition by t.gmail_message_id order by t.occurred_at, t.legacy_id) as gmail_rn
    from legacy_v.touchpoints t
   where migration.in_scope(t.org_id)
)
insert into public.touch as x (
  tenant_id, occurred_at, user_id, account_id, contact_id, property_id, opportunity_id,
  channel, direction, outcome, notes, source, external_id, legacy_table, legacy_id, created_at)
select migration.tenant_id(),
       coalesce(t.occurred_at, t.created_at),
       migration.uid(t.actor_legacy_user_id),
       acc.id, con.id, prop.id, opp.id,
       migration.map('touch_type', t.touch_type),
       migration.map('touch_direction', t.direction),
       migration.map('touch_outcome', t.outcome),
       t.notes,
       'dillyv2',
       case when t.gmail_message_id is not null and t.gmail_rn = 1
             and not exists (select 1 from public.touch e
                              where e.tenant_id = migration.tenant_id() and e.source = 'dillyv2'
                                and e.external_id = 'gmail:' || t.gmail_message_id and e.legacy_id is distinct from t.legacy_id)
            then 'gmail:' || t.gmail_message_id end,
       t.legacy_table, t.legacy_id,
       coalesce(t.created_at, t.occurred_at)
  from src t
  left join public.account     acc  on acc.tenant_id  = migration.tenant_id() and acc.legacy_table  = migration.lt('accounts')      and acc.legacy_id  = t.account_legacy_id
  left join public.contact     con  on con.tenant_id  = migration.tenant_id() and con.legacy_table  = migration.lt('contacts')      and con.legacy_id  = t.contact_legacy_id
  left join public.property    prop on prop.tenant_id = migration.tenant_id() and prop.legacy_table = migration.lt('properties')    and prop.legacy_id = t.property_legacy_id
  left join public.opportunity opp  on opp.tenant_id  = migration.tenant_id() and opp.legacy_table  = migration.lt('opportunities') and opp.legacy_id  = t.opportunity_legacy_id
 order by coalesce(t.occurred_at, t.created_at), t.legacy_id
on conflict (tenant_id, legacy_table, legacy_id) where legacy_id is not null do update set
  notes = excluded.notes;

insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
select migration.tenant_id(), 'touch', x.id, t.legacy_table, t.legacy_id, f.field, f.value
  from legacy_v.touchpoints t
  join public.touch x on x.tenant_id = migration.tenant_id() and x.legacy_table = t.legacy_table and x.legacy_id = t.legacy_id
  cross join lateral (values
    ('provenance', migration.map('touch_source', t.touch_source)),
    ('gmail_message_id', t.gmail_message_id),
    ('gmail_thread_id', t.gmail_thread_id),
    ('legacy_points', t.legacy_points),
    ('legacy_type', t.touch_type),
    ('legacy_outcome', t.outcome)) f(field, value)
 where migration.in_scope(t.org_id) and f.value is not null
on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

insert into migration.flagged_row(tenant_id, legacy_table, legacy_id, flag, detail)
select migration.tenant_id(), t.legacy_table, t.legacy_id, f.flag, f.detail
  from legacy_v.touchpoints t
  join public.touch x on x.tenant_id = migration.tenant_id() and x.legacy_table = t.legacy_table and x.legacy_id = t.legacy_id
  cross join lateral (values
    (case when t.gmail_message_id is not null and x.external_id is null then 'duplicate_gmail_message' end,
     'Gmail message ' || t.gmail_message_id || ' was logged more than once in V2; id kept in migration.legacy_value'),
    (case when t.contact_legacy_id is not null and x.contact_id is null then 'orphan' end, 'contact ' || t.contact_legacy_id || ' missing'),
    (case when t.account_legacy_id is not null and x.account_id is null then 'orphan' end, 'account ' || t.account_legacy_id || ' missing'),
    (case when migration.looks_test(t.notes) then 'test_note' end, left(t.notes, 200))) f(flag, detail)
 where migration.in_scope(t.org_id) and f.flag is not null
on conflict (tenant_id, legacy_table, legacy_id, flag) do update set detail = excluded.detail;

select migration.note_actors('touchpoints', 'actor_legacy_user_id', 'actor');
