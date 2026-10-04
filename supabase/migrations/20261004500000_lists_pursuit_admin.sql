-- Dilly — active pursuit, lists (static + smart, assignable), and the admin area. Additive only (launch week).
-- New tables use the InitPlan RLS form from 20261004000500_performance.sql.
--
-- PURSUIT
--   property_pursuit   a rep is actively pursuing a building. One ACTIVE row per (property, user); ending it
--                      (paused / won / lost / dropped) stamps ended_at and keeps the row as history.
--   set_pursuit()      the one write path the app uses (toggle on detail, rows, Go stops; "Mark all active").
--
-- LISTS
--   list               static (hand-picked items) or smart (filter jsonb = the Properties list URL params,
--                      evaluated by the app over property_current). private | team visibility.
--   list_item          static list members (ordered by position).
--   list_assignment    a manager hands a list to reps: it shows on their Lists tab and feeds their Go working list.
--   list_property_current  list_item ⋈ property_current, so a list page filters/sorts like the Properties list.
--   System smart lists are seeded for every tenant (and for every new tenant by trigger): see app.seed_system_lists.
--   list_from_import() makes "Import — <file> — <date>" from an import batch.
--
-- ADMIN
--   admin_audit        append-only: who changed whom, when, before → after (roles, deactivation, logins, company).
--   Last-owner guard   a company always keeps one active owner (role change, deactivate, delete).
--   tenant_member_activity()  last sign-in (auth.users) + last touch per member, for owners/admins/managers.

-- ---------------------------------------------------------------------------
-- 1) Active pursuit
-- ---------------------------------------------------------------------------
create table if not exists public.property_pursuit (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  property_id  uuid not null references public.property(id) on delete cascade,
  user_id      uuid not null references public.profile(id) on delete cascade,
  status       text not null default 'active' check (status in ('active','paused','won','lost','dropped')),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz,
  note         text check (note is null or char_length(note) <= 500),
  created_by   uuid references public.profile(id) on delete set null,
  check ((status = 'active') = (ended_at is null))
);
create unique index if not exists property_pursuit_one_active on public.property_pursuit(property_id, user_id) where status = 'active';
create index if not exists property_pursuit_user_idx on public.property_pursuit(tenant_id, user_id) where status = 'active';
create index if not exists property_pursuit_property_idx on public.property_pursuit(property_id, started_at desc);

create or replace function app.same_tenant_property() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if not exists (select 1 from public.property p where p.id = new.property_id and p.tenant_id = new.tenant_id) then
    raise exception 'property is not in this company' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists property_pursuit_tenant on public.property_pursuit;
create trigger property_pursuit_tenant before insert or update of property_id, tenant_id on public.property_pursuit
  for each row execute function app.same_tenant_property();

alter table public.property_pursuit enable row level security;
drop policy if exists property_pursuit_select on public.property_pursuit;
create policy property_pursuit_select on public.property_pursuit for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
-- Reps start/stop their own; managers may do it for anyone on their team.
drop policy if exists property_pursuit_insert on public.property_pursuit;
create policy property_pursuit_insert on public.property_pursuit for insert to authenticated
  with check (tenant_id = any ((select app.my_tenant_ids())::uuid[])
              and (user_id = auth.uid() or tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[])));
drop policy if exists property_pursuit_update on public.property_pursuit;
create policy property_pursuit_update on public.property_pursuit for update to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[])
         and (user_id = auth.uid() or tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[])))
  with check (tenant_id = any ((select app.my_tenant_ids())::uuid[])
         and (user_id = auth.uid() or tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[])));
-- No delete policy: history is kept.
grant select, insert, update on public.property_pursuit to authenticated;
grant all on public.property_pursuit to service_role;

-- Start (p_status = 'active') or end (paused/won/lost/dropped) pursuit of buildings for a rep (default: me).
-- Idempotent: starting an active pursuit or ending one that isn't active changes nothing. SECURITY INVOKER: RLS applies.
-- Returns the number of buildings whose state changed.
create or replace function public.set_pursuit(p_properties uuid[], p_status text, p_note text default null, p_user uuid default null)
returns int language plpgsql as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  n int := 0;
  k int;
begin
  if v_user is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_status not in ('active','paused','won','lost','dropped') then raise exception 'bad status' using errcode = '22023'; end if;
  if coalesce(array_length(p_properties, 1), 0) > 500 then raise exception 'up to 500 at a time' using errcode = '22023'; end if;
  if p_status = 'active' then
    insert into public.property_pursuit(tenant_id, property_id, user_id, status, note, created_by)
    select p.tenant_id, p.id, v_user, 'active', nullif(trim(p_note), ''), auth.uid()
      from public.property p
     where p.id = any(p_properties) and p.duplicate_of is null
    on conflict (property_id, user_id) where status = 'active' do nothing;
    get diagnostics n = row_count;
  else
    update public.property_pursuit
       set status = p_status, ended_at = now(), note = coalesce(nullif(trim(p_note), ''), note)
     where property_id = any(p_properties) and user_id = v_user and status = 'active';
    get diagnostics k = row_count;
    n := k;
  end if;
  return n;
end $$;
revoke all on function public.set_pursuit(uuid[], text, text, uuid) from public;
grant execute on function public.set_pursuit(uuid[], text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Lists
-- ---------------------------------------------------------------------------
create table if not exists public.list (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  name            text not null check (char_length(trim(name)) between 1 and 120),
  description     text check (description is null or char_length(description) <= 500),
  kind            text not null default 'static' check (kind in ('static','smart')),
  filter          jsonb not null default '{}'::jsonb,
  entity          text not null default 'property' check (entity in ('property','account')),
  owner_user_id   uuid references public.profile(id) on delete set null,
  visibility      text not null default 'private' check (visibility in ('private','team')),
  created_from    text not null default 'manual' check (created_from in ('manual','filter','import','system')),
  system_key      text,
  import_batch_id uuid references public.import_batch(id) on delete set null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (kind = 'smart' or filter = '{}'::jsonb),
  check ((created_from = 'system') = (system_key is not null))
);
create unique index if not exists list_system_key on public.list(tenant_id, system_key) where system_key is not null;
create index if not exists list_tenant_idx on public.list(tenant_id, created_at desc);
create index if not exists list_import_idx on public.list(import_batch_id) where import_batch_id is not null;
drop trigger if exists list_updated on public.list;
create trigger list_updated before update on public.list for each row execute function app.touch_updated_at();

create table if not exists public.list_item (
  list_id      uuid not null references public.list(id) on delete cascade,
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  property_id  uuid not null references public.property(id) on delete cascade,
  added_by     uuid references public.profile(id) on delete set null,
  added_at     timestamptz not null default now(),
  position     int not null default 0,
  primary key (list_id, property_id)
);
create index if not exists list_item_property_idx on public.list_item(property_id);
create index if not exists list_item_order_idx on public.list_item(list_id, position);

create table if not exists public.list_assignment (
  list_id      uuid not null references public.list(id) on delete cascade,
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  user_id      uuid not null references public.profile(id) on delete cascade,
  assigned_by  uuid references public.profile(id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists list_assignment_user_idx on public.list_assignment(tenant_id, user_id);

-- list_item / list_assignment carry tenant_id for the InitPlan policy; it must match the list (and the building/rep).
create or replace function app.list_child_check() returns trigger language plpgsql security definer set search_path = public, app as $$
declare l public.list;
begin
  select * into l from public.list where id = new.list_id;
  if l.id is null then raise exception 'list not found' using errcode = '23503'; end if;
  new.tenant_id := l.tenant_id;
  if tg_table_name = 'list_item' then
    if l.kind <> 'static' then raise exception 'smart lists fill themselves from their filter' using errcode = '22023'; end if;
    if not exists (select 1 from public.property p where p.id = new.property_id and p.tenant_id = l.tenant_id) then
      raise exception 'property is not in this company' using errcode = '23514';
    end if;
  else
    if not exists (select 1 from public.membership m where m.tenant_id = l.tenant_id and m.user_id = new.user_id and m.active) then
      raise exception 'that person is not on this team' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists list_item_check on public.list_item;
create trigger list_item_check before insert or update on public.list_item for each row execute function app.list_child_check();
drop trigger if exists list_assignment_check on public.list_assignment;
create trigger list_assignment_check before insert or update on public.list_assignment for each row execute function app.list_child_check();

alter table public.list            enable row level security;
alter table public.list_item       enable row level security;
alter table public.list_assignment enable row level security;

-- Who can see a list: its tenant's members when it's a team list; otherwise its owner, managers+, and assignees.
drop policy if exists list_select on public.list;
create policy list_select on public.list for select to authenticated using (
  tenant_id = any ((select app.my_tenant_ids())::uuid[])
  and (visibility = 'team'
       or owner_user_id = auth.uid()
       or tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[])
       or exists (select 1 from public.list_assignment a where a.list_id = list.id and a.user_id = auth.uid())));
-- Anyone on the team makes their own lists; system lists are made by the database only.
drop policy if exists list_insert on public.list;
create policy list_insert on public.list for insert to authenticated with check (
  tenant_id = any ((select app.my_tenant_ids())::uuid[]) and owner_user_id = auth.uid() and created_from <> 'system');
drop policy if exists list_update on public.list;
create policy list_update on public.list for update to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[])
         and (owner_user_id = auth.uid() or tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[])))
  with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
drop policy if exists list_delete on public.list;
create policy list_delete on public.list for delete to authenticated using (
  created_from <> 'system' and tenant_id = any ((select app.my_tenant_ids())::uuid[])
  and (owner_user_id = auth.uid() or tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[])));

drop policy if exists list_item_select on public.list_item;
create policy list_item_select on public.list_item for select to authenticated using (
  tenant_id = any ((select app.my_tenant_ids())::uuid[]) and exists (select 1 from public.list l where l.id = list_item.list_id));
drop policy if exists list_item_write on public.list_item;
create policy list_item_write on public.list_item for all to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[])
         and exists (select 1 from public.list l where l.id = list_item.list_id
                      and (l.owner_user_id = auth.uid() or l.tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]))))
  with check (tenant_id = any ((select app.my_tenant_ids())::uuid[])
         and exists (select 1 from public.list l where l.id = list_item.list_id
                      and (l.owner_user_id = auth.uid() or l.tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]))));

drop policy if exists list_assignment_select on public.list_assignment;
create policy list_assignment_select on public.list_assignment for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
drop policy if exists list_assignment_write on public.list_assignment;
create policy list_assignment_write on public.list_assignment for all to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]))
  with check (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]));

grant select, insert, update, delete on public.list, public.list_item, public.list_assignment to authenticated;
grant all on public.list, public.list_item, public.list_assignment to service_role;

-- A static list's buildings with every property_current column (security_invoker: RLS of every table applies).
create or replace view public.list_property_current with (security_invoker = true) as
select li.list_id, li.position as list_position, li.added_at as list_added_at, pc.*
  from public.list_item li
  join public.property_current pc on pc.id = li.property_id;
grant select on public.list_property_current to authenticated, service_role;

-- System smart lists. Filters use the Properties list URL params (src/lib/lists/filter.ts SYSTEM_LISTS mirrors this).
create or replace function app.seed_system_lists(t uuid) returns int language plpgsql security definer set search_path = public, app as $$
declare n int;
begin
  insert into public.list(tenant_id, name, description, kind, filter, visibility, created_from, system_key)
  select t, x.name, x.description, 'smart', x.filter::jsonb, 'team', 'system', x.k
    from (values
      ('oldest_quiet',   'Oldest roofs · quiet 60 days',  'Known roof age, oldest first, nobody has touched the building in 60 days.', '{"stale":"1"}'),
      ('warranty_12mo',  'Warranty ending in 12 months',  'Manufacturer warranty runs out within a year — the replacement conversation.', '{"warranty":"1"}'),
      ('leaks_damage',   'Open leaks & damage',           'Buildings with an active leak or damage flag set by the team.', '{"cond":"damage"}'),
      ('new_mgmt_90',    'New management (90 days)',      'Management company changed in the last 90 days — new people to meet.', '{"newmgmt":"1"}'),
      ('never_touched',  'Never touched',                 'No call, visit or email logged at the building yet.', '{"never":"1"}'),
      ('storm_30',       'Storm hit (30 days)',           'Hail, wind or storm reported at the building or its market in the last 30 days.', '{"storm":"1"}')
    ) as x(k, name, description, filter)
  on conflict (tenant_id, system_key) where system_key is not null do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function app.on_tenant_created() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  perform app.seed_system_lists(new.id);
  return new;
end $$;
drop trigger if exists tenant_seed_lists on public.tenant;
create trigger tenant_seed_lists after insert on public.tenant for each row execute function app.on_tenant_created();

select app.seed_system_lists(id) from public.tenant;

-- Import → static list "Import — <file> — <date>" with every building the import created or linked (p_properties),
-- plus anything tagged with the batch. Idempotent per batch. Managers+ (same as importing).
create or replace function public.list_from_import(p_batch uuid, p_properties uuid[] default null) returns uuid
language plpgsql security definer set search_path = public, app as $$
declare
  b public.import_batch;
  v uuid;
begin
  select * into b from public.import_batch where id = p_batch;
  if b.id is null then raise exception 'import not found' using errcode = 'P0002'; end if;
  perform app.require_manager(b.tenant_id);
  select id into v from public.list where import_batch_id = p_batch and created_from = 'import' limit 1;
  if v is null then
    insert into public.list(tenant_id, name, kind, owner_user_id, visibility, created_from, import_batch_id, description)
    values (b.tenant_id,
            left('Import — ' || coalesce(nullif(b.file_name, ''), 'pasted rows') || ' — ' || to_char(app.tenant_today(b.tenant_id), 'Mon FMDD, YYYY'), 120),
            'static', auth.uid(), 'team', 'import', p_batch,
            'Every building in this import.')
    returning id into v;
  end if;
  insert into public.list_item(list_id, tenant_id, property_id, added_by, position)
  select v, b.tenant_id, x.id, auth.uid(), (row_number() over (order by x.ord))::int
    from (select p.id, min(p.ord) as ord from (
            select u.id, u.ord from unnest(coalesce(p_properties, '{}'::uuid[])) with ordinality as u(id, ord)
            union all
            select pr.id, 1000000 + row_number() over (order by pr.created_at) from public.property pr where pr.import_batch_id = p_batch
          ) p group by p.id) x
    join public.property pp on pp.id = x.id and pp.tenant_id = b.tenant_id
  on conflict (list_id, property_id) do nothing;
  return v;
end $$;
revoke all on function public.list_from_import(uuid, uuid[]) from public;
grant execute on function public.list_from_import(uuid, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Admin audit (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.admin_audit (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenant(id) on delete cascade,
  actor_user_id   uuid references public.profile(id) on delete set null,
  action          text not null,
  target_user_id  uuid references public.profile(id) on delete set null,
  target_email    text,
  before          jsonb,
  after           jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists admin_audit_tenant_idx on public.admin_audit(tenant_id, created_at desc);
alter table public.admin_audit enable row level security;
drop policy if exists admin_audit_select on public.admin_audit;
create policy admin_audit_select on public.admin_audit for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]));
drop policy if exists admin_audit_insert on public.admin_audit;
create policy admin_audit_insert on public.admin_audit for insert to authenticated
  with check (actor_user_id = auth.uid() and tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin']))::uuid[]));
grant select, insert on public.admin_audit to authenticated;
grant all on public.admin_audit to service_role;

-- ---------------------------------------------------------------------------
-- 4) A company always keeps one active owner.
--    Cascades (company or person deleted) are allowed: the parent row is already gone when this runs.
-- ---------------------------------------------------------------------------
create or replace function app.membership_owner_guard() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active or new.tenant_id <> old.tenant_id)
     and exists (select 1 from public.tenant t where t.id = old.tenant_id)
     and exists (select 1 from public.profile p where p.id = old.user_id)
     and not exists (select 1 from public.membership m
                      where m.tenant_id = old.tenant_id and m.user_id <> old.user_id and m.role = 'owner' and m.active) then
    raise exception 'a company needs at least one active owner — make someone else owner first' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists membership_owner_guard on public.membership;
create trigger membership_owner_guard before update or delete on public.membership
  for each row execute function app.membership_owner_guard();

-- ---------------------------------------------------------------------------
-- 5) Member activity for the admin Team table: last sign-in (auth) + last touch. Owners/admins/managers.
-- ---------------------------------------------------------------------------
create or replace function public.tenant_member_activity(p_tenant uuid)
returns table (user_id uuid, last_sign_in_at timestamptz, last_touch_at timestamptz)
language plpgsql stable security definer set search_path = public, app as $$
begin
  perform app.require_manager(p_tenant);
  return query
    select m.user_id,
           (select u.last_sign_in_at from auth.users u where u.id = m.user_id),
           (select max(t.occurred_at) from public.touch t where t.tenant_id = p_tenant and t.user_id = m.user_id and t.voided_at is null)
      from public.membership m
     where m.tenant_id = p_tenant;
end $$;
revoke all on function public.tenant_member_activity(uuid) from public;
grant execute on function public.tenant_member_activity(uuid) to authenticated, service_role;
