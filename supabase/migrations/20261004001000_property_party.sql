-- Dilly — ownership & management history ("properties change hands; the building and its history stay").
--
--   property_party      who owns / manages / asset-manages / occupies a building, and when. History rows are never
--                       deleted: a change ends the current row and starts a new one.
--   contact_employment  where a person worked, and when ("follow the people").
--
-- property.account_id stays as the denormalized "current manager, else current owner" so every existing screen,
-- account_ranked and rep_queue keep working. It is maintained from property_party by trigger; a direct write to
-- property.account_id (old edit forms, imports, the V2 migration kit) is turned into a history row, so the two
-- can never drift.
--
-- Semantics (documented for reps in the transfer sheet):
--   * Everything attached to the building stays on the building: touches, photos (touch.media), roof facts, flags,
--     opportunities, tasks. Nothing is recreated.
--   * OPEN opportunities follow the party that buys roofing for the building = property.account_id (the manager,
--     else the owner). Changing the owner of a managed building therefore moves no opportunities; changing the
--     manager does. Won/lost opportunities stay with the company that did the business.
--   * People: contacts "with the building" (on-site staff: community manager, maintenance, leasing) become employees
--     of the new company; contacts "with the old company" (regional, corporate) keep their company and are unlinked
--     from this building. Anyone not listed is left exactly as is.

create domain app.party_role as text check (value in ('owner','manager','asset_manager','tenant_occupant'));

create table public.property_party (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  property_id uuid not null references public.property(id) on delete cascade,
  account_id  uuid not null references public.account(id) on delete cascade,
  role        app.party_role not null,
  started_on  date,                 -- null = before Dilly knew (backfill / first link)
  ended_on    date,                 -- null = current
  source      text not null default 'rep'
              check (source in ('rep','transfer','backfill','insert','direct_edit','dillyv2','import','agent')),
  note        text,
  created_by  uuid references public.profile(id),
  created_at  timestamptz not null default now(),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);
-- At most one current row per (property, role).
create unique index property_party_current_uq on public.property_party(property_id, role) where ended_on is null;
create index property_party_property_idx on public.property_party(property_id, role, ended_on);
create index property_party_account_idx  on public.property_party(account_id, ended_on);
create index property_party_tenant_idx   on public.property_party(tenant_id);

create table public.contact_employment (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  contact_id  uuid not null references public.contact(id) on delete cascade,
  account_id  uuid not null references public.account(id) on delete cascade,
  title       text,
  started_on  date,
  ended_on    date,
  note        text,
  source      text not null default 'rep'
              check (source in ('rep','move','transfer','backfill','insert','direct_edit','dillyv2','import','agent')),
  created_by  uuid references public.profile(id),
  created_at  timestamptz not null default now(),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);
create unique index contact_employment_current_uq on public.contact_employment(contact_id) where ended_on is null;
create index contact_employment_contact_idx on public.contact_employment(contact_id, started_on);
create index contact_employment_account_idx on public.contact_employment(account_id);

-- Tasks the queue must surface first (management-change intros, reconnects). Added to rep_queue's score.
alter table public.task add column boost smallint not null default 0 check (boost between 0 and 200);

-- ---------------------------------------------------------------------------
-- RLS (same shape as 20261003000600_rls.sql: members read/write, admins delete).
-- ---------------------------------------------------------------------------
alter table public.property_party enable row level security;
alter table public.contact_employment enable row level security;
do $$
declare t text;
begin
  for t in select unnest(array['property_party','contact_employment'])
  loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated using (app.is_member(tenant_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated with check (app.is_member(tenant_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated using (app.is_member(tenant_id)) with check (app.is_member(tenant_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$I for delete to authenticated using (app.has_role(tenant_id, array['owner','admin']))$f$, t);
  end loop;
end $$;
grant select, insert, update, delete on public.property_party, public.contact_employment to authenticated;
grant all on public.property_party, public.contact_employment to service_role;

-- ---------------------------------------------------------------------------
-- Integrity: a party / employment row must point at records of its own tenant.
-- ---------------------------------------------------------------------------
create or replace function app.party_tenant_check() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if tg_table_name = 'property_party' then
    if not exists (select 1 from public.property where id = new.property_id and tenant_id = new.tenant_id)
       or not exists (select 1 from public.account where id = new.account_id and tenant_id = new.tenant_id) then
      raise exception 'property and account must belong to the same company' using errcode = '23514';
    end if;
  else
    if not exists (select 1 from public.contact where id = new.contact_id and tenant_id = new.tenant_id)
       or not exists (select 1 from public.account where id = new.account_id and tenant_id = new.tenant_id) then
      raise exception 'contact and account must belong to the same company' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger property_party_tenant before insert or update of tenant_id, property_id, account_id on public.property_party
  for each row execute function app.party_tenant_check();
create trigger contact_employment_tenant before insert or update of tenant_id, contact_id, account_id on public.contact_employment
  for each row execute function app.party_tenant_check();

-- ---------------------------------------------------------------------------
-- property.account_id  <-  property_party
-- ---------------------------------------------------------------------------
create or replace function app.party_account(p uuid) returns uuid language sql stable security definer set search_path = public, app as $$
  select coalesce(
    (select account_id from public.property_party where property_id = p and role = 'manager' and ended_on is null),
    (select account_id from public.property_party where property_id = p and role = 'owner'   and ended_on is null))
$$;

create or replace function app.sync_property_account(p uuid) returns void language plpgsql security definer set search_path = public, app as $$
declare v uuid := app.party_account(p);
begin
  update public.property set account_id = v where id = p and account_id is distinct from v;
end $$;

create or replace function app.on_party_change() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if coalesce(current_setting('app.party_sync', true), '') = 'off' then return null; end if;
  if tg_op in ('UPDATE','DELETE') then perform app.sync_property_account(old.property_id); end if;
  if tg_op in ('INSERT','UPDATE') and (tg_op = 'INSERT' or new.property_id <> old.property_id) then
    perform app.sync_property_account(new.property_id);
  end if;
  return null;
end $$;
create trigger property_party_sync after insert or update or delete on public.property_party
  for each row execute function app.on_party_change();

-- A property created with an account gets its first (current) manager row.
create or replace function app.on_property_insert_party() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.account_id is not null then
    insert into public.property_party(tenant_id, property_id, account_id, role, started_on, source, created_by)
    values (new.tenant_id, new.id, new.account_id, 'manager', null,
            case new.source when 'dillyv2' then 'dillyv2' when 'import' then 'import' when 'agent' then 'agent' else 'insert' end,
            new.created_by);
  end if;
  return null;
end $$;
create trigger property_party_on_insert after insert on public.property
  for each row execute function app.on_property_insert_party();

-- A direct write to property.account_id becomes history: the role that drives account_id (manager, else owner)
-- ends today and the written account starts today. Writes that already agree with property_party (our own sync)
-- are ignored. Setting it to null ends the current manager and owner rows.
create or replace function app.on_property_account_write() returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_today date := app.tenant_today(new.tenant_id);
  v_role  text;
begin
  if new.account_id is not distinct from app.party_account(new.id) then return null; end if;
  if new.account_id is null then
    -- During an account delete the FK cascade sets account_id null; property_party rows go with the account.
    if not exists (select 1 from public.account where id = old.account_id) then return null; end if;
    update public.property_party set ended_on = greatest(v_today, coalesce(started_on, v_today))
     where property_id = new.id and role in ('manager','owner') and ended_on is null;
    return null;
  end if;
  v_role := case
    when exists (select 1 from public.property_party where property_id = new.id and role = 'manager' and ended_on is null) then 'manager'
    when exists (select 1 from public.property_party where property_id = new.id and role = 'owner' and ended_on is null) then 'owner'
    else 'manager' end;
  perform set_config('app.party_sync', 'off', true);
  update public.property_party set ended_on = greatest(v_today, coalesce(started_on, v_today))
   where property_id = new.id and role = v_role and ended_on is null;
  insert into public.property_party(tenant_id, property_id, account_id, role, started_on, source, created_by)
  values (new.tenant_id, new.id, new.account_id, v_role, v_today, 'direct_edit', auth.uid());
  perform set_config('app.party_sync', 'on', true);
  perform app.sync_property_account(new.id);
  return null;
end $$;
create trigger property_account_write after update of account_id on public.property
  for each row when (old.account_id is distinct from new.account_id)
  execute function app.on_property_account_write();

-- ---------------------------------------------------------------------------
-- contact.account_id  <->  contact_employment
-- ---------------------------------------------------------------------------
create or replace function app.on_contact_employment_write() returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_today date := app.tenant_today(new.tenant_id);
  v_cur   public.contact_employment;
begin
  select * into v_cur from public.contact_employment where contact_id = new.id and ended_on is null;
  if tg_op = 'INSERT' then
    if new.account_id is not null and v_cur.id is null then
      insert into public.contact_employment(tenant_id, contact_id, account_id, title, started_on, source, created_by)
      values (new.tenant_id, new.id, new.account_id, new.title, null,
              case new.source when 'dillyv2' then 'dillyv2' when 'import' then 'import' when 'agent' then 'agent' else 'insert' end,
              new.created_by);
    end if;
    return null;
  end if;

  -- UPDATE
  if v_cur.account_id is not distinct from new.account_id then
    -- In sync (move_contact already wrote history). Keep the current row's title in step with edits.
    if v_cur.id is not null and new.title is distinct from old.title then
      update public.contact_employment set title = new.title where id = v_cur.id;
    end if;
    return null;
  end if;
  if new.account_id is null and old.account_id is not null
     and not exists (select 1 from public.account where id = old.account_id) then
    return null;  -- account being deleted; its employment rows cascade
  end if;
  if v_cur.id is not null then
    update public.contact_employment set ended_on = greatest(v_today, coalesce(started_on, v_today)) where id = v_cur.id;
  end if;
  if new.account_id is not null then
    insert into public.contact_employment(tenant_id, contact_id, account_id, title, started_on, source, created_by)
    values (new.tenant_id, new.id, new.account_id, new.title, v_today, 'direct_edit', auth.uid());
  end if;
  return null;
end $$;
create trigger contact_employment_on_insert after insert on public.contact
  for each row execute function app.on_contact_employment_write();
create trigger contact_employment_on_update after update of account_id, title on public.contact
  for each row when (old.account_id is distinct from new.account_id or old.title is distinct from new.title)
  execute function app.on_contact_employment_write();

-- ---------------------------------------------------------------------------
-- Backfill: every existing link becomes a current history row (migrated V2 data included).
-- ---------------------------------------------------------------------------
insert into public.property_party(tenant_id, property_id, account_id, role, started_on, source, created_by)
select p.tenant_id, p.id, p.account_id, 'manager', null, 'backfill', p.created_by
  from public.property p
 where p.account_id is not null
   and not exists (select 1 from public.property_party x where x.property_id = p.id and x.role = 'manager' and x.ended_on is null);

insert into public.contact_employment(tenant_id, contact_id, account_id, title, started_on, source, created_by)
select c.tenant_id, c.id, c.account_id, c.title, null, 'backfill', c.created_by
  from public.contact c
 where c.account_id is not null
   and not exists (select 1 from public.contact_employment x where x.contact_id = c.id and x.ended_on is null);

-- ---------------------------------------------------------------------------
-- Helpers used by the business functions below.
-- ---------------------------------------------------------------------------

-- Remove contact↔property links. property_contact deletes are admin-only under RLS; this lets any member of the
-- property's tenant unlink people as part of a transfer / company move. Nothing else is deleted.
create or replace function app.unlink_property_contacts(p_property uuid, p_contacts uuid[]) returns int
language plpgsql security definer set search_path = public, app as $$
declare n int;
begin
  if not exists (select 1 from public.property p where p.id = p_property and app.is_member(p.tenant_id)) then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
  delete from public.property_contact where property_id = p_property and contact_id = any(coalesce(p_contacts, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;

-- Close the contact's current job and open a new one, then point the contact at the new account.
-- SECURITY INVOKER: RLS applies to every read and write.
create or replace function app.employ_contact(p_contact uuid, p_account uuid, p_title text, p_effective date, p_note text, p_source text)
returns uuid language plpgsql security invoker set search_path = public, app as $$
declare
  v_c   public.contact;
  v_cur public.contact_employment;
  v_id  uuid;
begin
  select * into v_c from public.contact where id = p_contact for update;
  if v_c.id is null then raise exception 'contact not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.account where id = p_account and tenant_id = v_c.tenant_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  select * into v_cur from public.contact_employment where contact_id = p_contact and ended_on is null for update;
  if v_cur.id is not null and v_cur.started_on is not null and p_effective < v_cur.started_on then
    raise exception 'The move date is before % started at their current company (%)', coalesce(v_c.full_name, 'this person'), v_cur.started_on
      using errcode = '22023';
  end if;
  if v_cur.id is not null then
    update public.contact_employment set ended_on = p_effective where id = v_cur.id;
  end if;
  insert into public.contact_employment(tenant_id, contact_id, account_id, title, started_on, note, source, created_by)
  values (v_c.tenant_id, p_contact, p_account, coalesce(p_title, v_c.title), p_effective, p_note, p_source, auth.uid())
  returning id into v_id;
  update public.contact set account_id = p_account, title = coalesce(p_title, title) where id = p_contact;
  -- Their open personal follow-ups move with them (job-tied opportunity tasks stay put).
  update public.task set account_id = p_account
   where contact_id = p_contact and status = 'open' and opportunity_id is null and account_id is distinct from p_account;
  return v_id;
end $$;

create or replace function app.party_role_label(r text) returns text language sql immutable as $$
  select case r when 'owner' then 'owner' when 'manager' then 'management' when 'asset_manager' then 'asset manager'
                when 'tenant_occupant' then 'tenant' else r end
$$;

-- ---------------------------------------------------------------------------
-- public.transfer_property — change who owns / manages a building without touching its data.
-- ---------------------------------------------------------------------------
create or replace function public.transfer_property(
  p_property                  uuid,
  p_role                      text,
  p_new_account               uuid,
  p_effective                 date   default null,          -- null = tenant-local today
  p_contacts_with_building    uuid[] default '{}',          -- on-site staff: become employees of the new company
  p_contacts_with_old_company uuid[] default '{}',          -- regional/corporate: keep their company, unlinked here
  p_note                      text   default null,
  p_intro_task                boolean default true          -- transfer_properties makes one portfolio task instead
) returns uuid
language plpgsql security invoker set search_path = public, app as $$
declare
  v_prop      public.property;
  v_new       public.account;
  v_cur       public.property_party;
  v_old_name  text;
  v_today     date;
  v_eff       date;
  v_party     uuid;
  v_before    uuid;
  v_after     uuid;
  v_kind      text;
  v_place     text;
  v_headline  text;
  v_title     text;
  v_assignee  uuid;
  v_opps      int := 0;
  v_moved     int := 0;
  v_unlinked  int := 0;
  v_cid       uuid;
begin
  if p_role is null or p_role not in ('owner','manager','asset_manager','tenant_occupant') then
    raise exception 'Unknown role "%"', p_role using errcode = '22023';
  end if;
  select * into v_prop from public.property where id = p_property for update;
  if v_prop.id is null then raise exception 'property not found' using errcode = 'P0002'; end if;
  select * into v_new from public.account where id = p_new_account;
  if v_new.id is null or v_new.tenant_id <> v_prop.tenant_id then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  v_today := app.tenant_today(v_prop.tenant_id);
  v_eff   := coalesce(p_effective, v_today);
  v_place := coalesce(v_prop.name, v_prop.address1, 'this property');
  v_before := v_prop.account_id;

  select * into v_cur from public.property_party
   where property_id = p_property and role = p_role and ended_on is null for update;
  if v_cur.id is not null and v_cur.account_id = p_new_account then
    raise exception '% is already the % of %', v_new.name, app.party_role_label(p_role), v_place using errcode = '23505';
  end if;
  if v_cur.id is not null and v_cur.started_on is not null and v_eff < v_cur.started_on then
    raise exception 'The change date is before the current % started (%)', app.party_role_label(p_role), v_cur.started_on
      using errcode = '22023';
  end if;
  if v_cur.id is not null then
    select name into v_old_name from public.account where id = v_cur.account_id;
  end if;

  -- 1) History: end the current row, start the new one. Sync account_id once at the end.
  perform set_config('app.party_sync', 'off', true);
  if v_cur.id is not null then
    update public.property_party set ended_on = v_eff where id = v_cur.id;
  end if;
  insert into public.property_party(tenant_id, property_id, account_id, role, started_on, source, note, created_by)
  values (v_prop.tenant_id, p_property, p_new_account, p_role, v_eff, 'transfer', p_note, auth.uid())
  returning id into v_party;
  perform set_config('app.party_sync', 'on', true);
  perform app.sync_property_account(p_property);
  select account_id into v_after from public.property where id = p_property;

  -- 2) Open opportunities follow the building's buying party (manager, else owner).
  if v_after is not null and v_after is distinct from v_before then
    update public.opportunity set account_id = v_after
     where property_id = p_property and stage not in ('won','lost')
       and (account_id is null or account_id is not distinct from v_before);
    get diagnostics v_opps = row_count;
    update public.task k set account_id = v_after
      from public.opportunity o
     where k.opportunity_id = o.id and o.property_id = p_property and o.account_id = v_after
       and k.status = 'open' and k.account_id is distinct from v_after;
  end if;

  -- 3) People.
  foreach v_cid in array coalesce(p_contacts_with_building, '{}') loop
    if exists (select 1 from public.contact where id = v_cid and account_id is not distinct from p_new_account) then
      continue;
    end if;
    perform app.employ_contact(v_cid, p_new_account, null, v_eff,
      'Stayed with ' || v_place || ' when ' || app.party_role_label(p_role) || ' changed to ' || v_new.name, 'transfer');
    v_moved := v_moved + 1;
  end loop;
  if coalesce(array_length(p_contacts_with_old_company, 1), 0) > 0 then
    v_unlinked := app.unlink_property_contacts(p_property, p_contacts_with_old_company);
  end if;

  -- 4) Signal (feeds badges and the daily brief).
  v_kind := case p_role when 'owner' then 'ownership_change' when 'tenant_occupant' then 'occupant_change' else 'management_change' end;
  v_headline := case
    when p_role = 'owner' and v_old_name is not null then v_place || ' sold: ' || v_old_name || ' to ' || v_new.name
    when p_role = 'owner' then v_place || ' is owned by ' || v_new.name
    when v_old_name is not null then v_place || ' moved from ' || v_old_name || ' to ' || v_new.name
    else v_place || ' is now with ' || v_new.name end;
  insert into public.signal(tenant_id, account_id, property_id, market_id, kind, headline, payload, weight, occurred_at, source)
  values (v_prop.tenant_id, p_new_account, p_property, v_prop.market_id, v_kind, v_headline,
          jsonb_build_object('role', p_role, 'party_id', v_party, 'effective_on', v_eff,
                             'from_account_id', v_cur.account_id, 'from', v_old_name,
                             'to_account_id', p_new_account, 'to', v_new.name,
                             'opportunities_moved', v_opps, 'contacts_moved', v_moved, 'contacts_unlinked', v_unlinked,
                             'by', auth.uid()),
          2.0, now(), 'rep');

  -- 5) The door-opener: an intro task that tops the queue tomorrow morning.
  if p_intro_task then
    v_assignee := coalesce((select owner_user_id from public.account where id = coalesce(v_after, p_new_account)), auth.uid());
    v_title := case p_role
      when 'owner' then 'Intro to new owner at ' || v_place
      when 'asset_manager' then 'Intro to new asset manager at ' || v_place
      when 'tenant_occupant' then 'Intro to new tenant at ' || v_place
      else 'Intro to new management at ' || v_place end;
    insert into public.task(tenant_id, assignee_user_id, account_id, property_id, kind, title, reason, due_on, priority, boost, source, created_by)
    values (v_prop.tenant_id, v_assignee, p_new_account, p_property, 'next_step', v_title, v_headline,
            app.add_business_days(v_today, 1), 85, 100, 'rule', auth.uid());
  end if;

  return v_party;
end $$;

-- Portfolio move: the same change for many buildings, all or nothing (one statement = one transaction).
-- Buildings already with the new company for that role are skipped. One intro task for the whole move.
create or replace function public.transfer_properties(
  p_properties                uuid[],
  p_role                      text,
  p_new_account               uuid,
  p_effective                 date   default null,
  p_contacts_with_building    uuid[] default '{}',
  p_contacts_with_old_company uuid[] default '{}',
  p_note                      text   default null
) returns uuid[]
language plpgsql security invoker set search_path = public, app as $$
declare
  v_pid    uuid;
  v_ids    uuid[] := '{}';
  v_tenant uuid;
  v_new    public.account;
  v_first  uuid;
  v_n      int;
  v_with   uuid[];
  v_old    uuid[];
begin
  if coalesce(array_length(p_properties, 1), 0) = 0 then
    raise exception 'Pick at least one property' using errcode = '22023';
  end if;
  select * into v_new from public.account where id = p_new_account;
  if v_new.id is null then raise exception 'company not found' using errcode = 'P0002'; end if;
  foreach v_pid in array p_properties loop
    if not exists (select 1 from public.property where id = v_pid) then
      raise exception 'property not found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.property_party where property_id = v_pid and role = p_role and ended_on is null
                and account_id = p_new_account) then
      continue;
    end if;
    -- Only people linked to this building are moved/unlinked by this building's change.
    select coalesce(array_agg(contact_id), '{}') into v_with from public.property_contact
     where property_id = v_pid and contact_id = any(coalesce(p_contacts_with_building, '{}'));
    select coalesce(array_agg(contact_id), '{}') into v_old from public.property_contact
     where property_id = v_pid and contact_id = any(coalesce(p_contacts_with_old_company, '{}'));
    v_ids := v_ids || public.transfer_property(v_pid, p_role, p_new_account, p_effective, v_with, v_old, p_note, false);
    v_first := coalesce(v_first, v_pid);
  end loop;

  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n > 0 then
    select tenant_id into v_tenant from public.property where id = v_first;
    insert into public.task(tenant_id, assignee_user_id, account_id, property_id, kind, title, reason, due_on, priority, boost, source, created_by)
    values (v_tenant, coalesce(v_new.owner_user_id, auth.uid()), p_new_account,
            case when v_n = 1 then v_first end, 'next_step',
            case when v_n = 1 then 'Intro to new ' || app.party_role_label(p_role) || ' at ' ||
                   coalesce((select coalesce(name, address1) from public.property where id = v_first), 'the property')
                 else 'Intro to ' || v_new.name || ': ' || v_n || ' properties just moved to them' end,
            v_n || case when v_n = 1 then ' property' else ' properties' end || ' moved to ' || v_new.name,
            app.add_business_days(app.tenant_today(v_tenant), 1), 85, 100, 'rule', auth.uid());
  end if;
  return v_ids;
end $$;

-- ---------------------------------------------------------------------------
-- public.move_contact — follow the people. The contact keeps every touch (touches hang off the contact),
-- gets a new current job, and becomes a warm lead at the new company.
-- ---------------------------------------------------------------------------
create or replace function public.move_contact(
  p_contact     uuid,
  p_new_account uuid,
  p_new_title   text default null,
  p_effective   date default null
) returns uuid
language plpgsql security invoker set search_path = public, app as $$
declare
  v_c        public.contact;
  v_new      public.account;
  v_old_name text;
  v_today    date;
  v_eff      date;
  v_emp      uuid;
  v_name     text;
  v_props    uuid[];
  v_unlinked int := 0;
  v_pid      uuid;
begin
  select * into v_c from public.contact where id = p_contact;
  if v_c.id is null then raise exception 'contact not found' using errcode = 'P0002'; end if;
  select * into v_new from public.account where id = p_new_account;
  if v_new.id is null or v_new.tenant_id <> v_c.tenant_id then raise exception 'company not found' using errcode = 'P0002'; end if;
  v_name := coalesce(v_c.full_name, v_c.email::text, 'this contact');
  if v_c.account_id = p_new_account then
    raise exception '% already works at %', v_name, v_new.name using errcode = '23505';
  end if;
  select name into v_old_name from public.account where id = v_c.account_id;
  v_today := app.tenant_today(v_c.tenant_id);
  v_eff   := coalesce(p_effective, v_today);

  -- Buildings they were tied to through the old company: they are no longer the person there.
  select coalesce(array_agg(pc.property_id), '{}') into v_props
    from public.property_contact pc join public.property p on p.id = pc.property_id
   where pc.contact_id = p_contact and v_c.account_id is not null and p.account_id = v_c.account_id;

  v_emp := app.employ_contact(p_contact, p_new_account, nullif(trim(p_new_title), ''), v_eff,
                              case when v_old_name is not null then 'Moved from ' || v_old_name end, 'move');

  foreach v_pid in array v_props loop
    v_unlinked := v_unlinked + app.unlink_property_contacts(v_pid, array[p_contact]);
  end loop;

  insert into public.signal(tenant_id, account_id, kind, headline, payload, weight, occurred_at, source)
  values (v_c.tenant_id, p_new_account, 'contact_moved',
          v_name || case when v_old_name is not null then ' moved from ' || v_old_name || ' to ' else ' joined ' end || v_new.name,
          jsonb_build_object('contact_id', p_contact, 'from_account_id', v_c.account_id, 'from', v_old_name,
                             'to_account_id', p_new_account, 'to', v_new.name, 'title', coalesce(nullif(trim(p_new_title), ''), v_c.title),
                             'effective_on', v_eff, 'properties_unlinked', v_unlinked, 'by', auth.uid()),
          1.5, now(), 'rep');

  insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, kind, title, reason, due_on, priority, boost, source, created_by)
  values (v_c.tenant_id, coalesce(v_new.owner_user_id, auth.uid()), p_new_account, p_contact, 'follow_up',
          'Reconnect with ' || v_name || ' at ' || v_new.name,
          'Warm lead' || case when v_old_name is not null then ' — you know them from ' || v_old_name else '' end,
          app.add_business_days(v_today, 1), 80, 40, 'rule', auth.uid());

  return v_emp;
end $$;

grant execute on function public.transfer_property(uuid, text, uuid, date, uuid[], uuid[], text, boolean) to authenticated, service_role;
grant execute on function public.transfer_properties(uuid[], text, uuid, date, uuid[], uuid[], text) to authenticated, service_role;
grant execute on function public.move_contact(uuid, uuid, text, date) to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
