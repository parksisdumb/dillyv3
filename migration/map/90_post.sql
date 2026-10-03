-- 90_post.sql — after every entity is loaded:
--   1. app.reconcile_tasks(tenant): closes every open task whose contact/account already has a later touch
--      (this is what clears most of the 150 overdue V2 follow-ups on day one).
--   2. Duplicate SUGGESTIONS (contacts, accounts, properties) into migration.duplicate_suggestion. Nothing is merged
--      and public.*.duplicate_of is not touched; merges happen in the app with an audit trail.
-- Nothing else is recomputed here (points and ICP score are recomputed by the app's own rules).

insert into migration.run_log(step, detail)
select 'reconcile_tasks', jsonb_build_object('tasks_closed', app.reconcile_tasks(migration.tenant_id()));

delete from migration.duplicate_suggestion where tenant_id = migration.tenant_id();

with c as (
  select id, account_id, created_at, lower(full_name) as nm, email::text as em,
         nullif(regexp_replace(coalesce(phone, mobile, ''), '\D', '', 'g'), '') as ph
    from public.contact where tenant_id = migration.tenant_id() and source = 'dillyv2'
), pairs as (
  select b.id as record_id, a.id as duplicate_of,
         concat_ws(', ',
           case when a.account_id = b.account_id and a.nm = b.nm then 'same name on same account' end,
           case when a.em = b.em then 'same email' end,
           case when a.ph = b.ph and length(a.ph) >= 10 then 'same phone' end) as reason
    from c a join c b on (a.created_at, a.id) < (b.created_at, b.id)
   where (a.account_id = b.account_id and a.nm = b.nm) or a.em = b.em or (a.ph = b.ph and length(a.ph) >= 10)
)
insert into migration.duplicate_suggestion(tenant_id, entity, record_id, duplicate_of, reason)
select distinct on (record_id) migration.tenant_id(), 'contact', record_id, duplicate_of, reason
  from pairs p order by record_id, (select created_at from public.contact where id = p.duplicate_of), duplicate_of
on conflict do nothing;

with a as (select id, created_at, normalized_name from public.account
            where tenant_id = migration.tenant_id() and source = 'dillyv2' and normalized_name is not null)
insert into migration.duplicate_suggestion(tenant_id, entity, record_id, duplicate_of, reason)
select distinct on (y.id) migration.tenant_id(), 'account', y.id, x.id, 'same normalized name'
  from a x join a y on x.normalized_name = y.normalized_name and (x.created_at, x.id) < (y.created_at, y.id)
 order by y.id, x.created_at, x.id
on conflict do nothing;

with p as (select id, created_at, normalized_address from public.property
            where tenant_id = migration.tenant_id() and source = 'dillyv2' and normalized_address is not null)
insert into migration.duplicate_suggestion(tenant_id, entity, record_id, duplicate_of, reason)
select distinct on (y.id) migration.tenant_id(), 'property', y.id, x.id, 'same normalized address'
  from p x join p y on x.normalized_address = y.normalized_address and (x.created_at, x.id) < (y.created_at, y.id)
 order by y.id, x.created_at, x.id
on conflict do nothing;

insert into migration.run_log(step, detail)
select 'transform', jsonb_build_object(
  'accounts', (select count(*) from public.account where tenant_id = migration.tenant_id() and source = 'dillyv2'),
  'contacts', (select count(*) from public.contact where tenant_id = migration.tenant_id() and source = 'dillyv2'),
  'properties', (select count(*) from public.property where tenant_id = migration.tenant_id() and source = 'dillyv2'),
  'opportunities', (select count(*) from public.opportunity where tenant_id = migration.tenant_id() and source = 'dillyv2'),
  'touches', (select count(*) from public.touch where tenant_id = migration.tenant_id() and source = 'dillyv2'),
  'tasks', (select count(*) from public.task where tenant_id = migration.tenant_id() and source = 'dillyv2'),
  'open_tasks', (select count(*) from public.task where tenant_id = migration.tenant_id() and source = 'dillyv2' and status = 'open'),
  'duplicate_suggestions', (select count(*) from migration.duplicate_suggestion where tenant_id = migration.tenant_id()),
  'unmapped_actors', (select count(*) from migration.unmapped_actor where tenant_id = migration.tenant_id() and resolved_profile_id is null));
