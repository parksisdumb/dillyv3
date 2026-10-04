-- Dilly — CSV import (with 24 h undo), bulk assign / reassign with an audit trail, and the 90-day scorecard.
-- Additive only (launch week, RUNBOOK §5): new tables, new nullable columns, new functions, new indexes.
-- New tables use the InitPlan RLS form from 20261004000500_performance.sql.
--
-- IMPORT
--   import_batch     one row per import (who, file, mapping, counts, status). Undo works off it for 24 h.
--   import_mapping   saved column mappings per tenant, keyed by the sheet's header signature.
--   *.import_batch_id  account / contact / property / property_contact rows created by an import carry the batch id,
--                    so undo deletes exactly what the import created and nothing else.
--   The app plans the import in the browser (pure functions, src/lib/domain/import/*) and commits it in chunks:
--     import_begin → import_accounts* → import_contacts* → import_properties* → import_finish
--   Each chunk is one RPC = one transaction. A browser that closes mid-way leaves a 'running' batch that can still be
--   undone. Accounts/properties re-check their dedupe key at insert time (normalized_name / normalized_address), so
--   a record created by someone else between preview and commit is linked, not duplicated.
--
-- BULK ASSIGN
--   bulk_update_accounts(owner / tier / preference) for managers. TASKS FOLLOW THE ACCOUNT OWNER: when the owner
--   changes, open tasks on the account (and on its contacts) that were assigned to the previous owner, or to nobody,
--   move to the new owner. Tasks a different teammate is holding stay with them. Every change is written to
--   account_change (who, when, field, old → new).
--
-- SCORECARD
--   account.paperwork_at: first time onboarding_status reached paperwork_received or later (stamped by trigger).
--   team_scorecard(): weekly (13 weeks) and monthly (this + last month) counts per rep. Definitions live in the
--   function comment and on the Team scorecard card.

-- ---------------------------------------------------------------------------
-- 0) Property units (multifamily door count) — a common column in owner/PMC sheets.
-- ---------------------------------------------------------------------------
alter table public.property add column if not exists unit_count integer check (unit_count is null or unit_count >= 0);

-- ---------------------------------------------------------------------------
-- 1) Import tables
-- ---------------------------------------------------------------------------
create table if not exists public.import_batch (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenant(id) on delete cascade,
  user_id      uuid references public.profile(id) on delete set null,
  file_name    text,
  mapping      jsonb not null default '{}'::jsonb,
  options      jsonb not null default '{}'::jsonb,
  row_count    integer not null default 0,
  counts       jsonb not null default '{}'::jsonb,
  status       text not null default 'running' check (status in ('running','done','failed','undone','partially_undone')),
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  undone_at    timestamptz,
  undone_by    uuid references public.profile(id) on delete set null,
  undo_report  jsonb
);
create index if not exists import_batch_tenant_idx on public.import_batch(tenant_id, created_at desc);

create table if not exists public.import_mapping (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  name        text not null,
  header_sig  text not null,               -- normalized, sorted header list: auto-applies when the same sheet comes back
  mapping     jsonb not null,               -- { "<header>": "<field key>" }
  options     jsonb not null default '{}'::jsonb,
  created_by  uuid references public.profile(id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (tenant_id, header_sig)
);

alter table public.account          add column if not exists import_batch_id uuid references public.import_batch(id) on delete set null;
alter table public.contact          add column if not exists import_batch_id uuid references public.import_batch(id) on delete set null;
alter table public.property         add column if not exists import_batch_id uuid references public.import_batch(id) on delete set null;
alter table public.property_contact add column if not exists import_batch_id uuid references public.import_batch(id) on delete set null;
create index if not exists account_import_batch_idx          on public.account(import_batch_id) where import_batch_id is not null;
create index if not exists contact_import_batch_idx          on public.contact(import_batch_id) where import_batch_id is not null;
create index if not exists property_import_batch_idx         on public.property(import_batch_id) where import_batch_id is not null;
create index if not exists property_contact_import_batch_idx on public.property_contact(import_batch_id) where import_batch_id is not null;
-- Undo checks "anything attached since?" by these FKs.
create index if not exists task_property_idx       on public.task(property_id) where property_id is not null;
create index if not exists opportunity_contact_idx on public.opportunity(primary_contact_id) where primary_contact_id is not null;

alter table public.import_batch   enable row level security;
alter table public.import_mapping enable row level security;
drop policy if exists import_batch_select on public.import_batch;
create policy import_batch_select on public.import_batch for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]));
drop policy if exists import_mapping_all on public.import_mapping;
create policy import_mapping_all on public.import_mapping for all to authenticated
  using (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]))
  with check (tenant_id = any ((select app.my_tenant_ids_with_role(array['owner','admin','manager']))::uuid[]));
grant select on public.import_batch to authenticated;
grant select, insert, update, delete on public.import_mapping to authenticated;
grant all on public.import_batch, public.import_mapping to service_role;

-- ---------------------------------------------------------------------------
-- 2) Import RPCs
-- ---------------------------------------------------------------------------
create or replace function app.require_manager(t uuid) returns void language plpgsql stable security definer set search_path = public, app as $$
begin
  if auth.uid() is null or not app.has_role(t, array['owner','admin','manager']) then
    raise exception 'only owners, admins and managers can do that' using errcode = '42501';
  end if;
end $$;

-- Running batch for this caller's tenant, or an error.
create or replace function app.import_batch_for_write(p_batch uuid) returns public.import_batch language plpgsql stable security definer set search_path = public, app as $$
declare b public.import_batch;
begin
  select * into b from public.import_batch where id = p_batch;
  if b.id is null then raise exception 'import not found' using errcode = 'P0002'; end if;
  perform app.require_manager(b.tenant_id);
  if b.status <> 'running' then raise exception 'this import is already %', b.status using errcode = '22023'; end if;
  return b;
end $$;

create or replace function public.import_begin(p_tenant uuid, p_file_name text, p_mapping jsonb, p_options jsonb, p_row_count int)
returns uuid language plpgsql security definer set search_path = public, app as $$
declare v uuid;
begin
  perform app.require_manager(p_tenant);
  if coalesce(p_row_count, 0) > 20000 then raise exception 'imports are limited to 20,000 rows' using errcode = '22023'; end if;
  insert into public.import_batch(tenant_id, user_id, file_name, mapping, options, row_count)
  values (p_tenant, auth.uid(), left(p_file_name, 200), coalesce(p_mapping, '{}'), coalesce(p_options, '{}'), coalesce(p_row_count, 0))
  returning id into v;
  return v;
end $$;

-- Accounts. Rows: [{key, action:'create'|'link', id?, name, account_type?, icp_tier?, owner_user_id?, phone?, website?,
-- address1?, city?, state?, zip?, notes?}]. Returns {key: account_id}. SECURITY INVOKER: RLS applies to every write.
create or replace function public.import_accounts(p_batch uuid, p_rows jsonb) returns jsonb language plpgsql as $$
declare
  b    public.import_batch := app.import_batch_for_write(p_batch);
  r    record;
  v_id uuid;
  out  jsonb := '{}'::jsonb;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(
      key text, action text, id uuid, name text, account_type text, icp_tier int, owner_user_id uuid,
      phone text, website text, address1 text, city text, state text, zip text, notes text)
  loop
    v_id := null;
    if r.action = 'link' then
      select id into v_id from public.account where id = r.id and tenant_id = b.tenant_id;
      if v_id is null then raise exception 'account to link no longer exists (%)', r.name using errcode = 'P0002'; end if;
    elsif r.action = 'create' then
      if coalesce(trim(r.name), '') = '' then raise exception 'account name is required' using errcode = '22023'; end if;
      -- Someone may have created it since the preview: link instead of duplicating.
      select id into v_id from public.account
       where tenant_id = b.tenant_id and duplicate_of is null and normalized_name = app.normalize_name(r.name)
       order by created_at limit 1;
      if v_id is null then
        if r.owner_user_id is not null and not exists (
             select 1 from public.membership m where m.tenant_id = b.tenant_id and m.user_id = r.owner_user_id and m.active) then
          raise exception 'rep for % is not on this team', r.name using errcode = '22023';
        end if;
        insert into public.account(tenant_id, name, account_type, icp_tier, owner_user_id, phone, website, address1, city, state, zip,
                                   notes, source, created_by, import_batch_id)
        values (b.tenant_id, trim(r.name), coalesce(nullif(r.account_type, ''), 'other'), coalesce(r.icp_tier, 3), r.owner_user_id,
                nullif(r.phone, ''), nullif(r.website, ''), nullif(r.address1, ''), nullif(r.city, ''), nullif(r.state, ''),
                nullif(r.zip, ''), nullif(r.notes, ''), 'import', auth.uid(), p_batch)
        returning id into v_id;
      end if;
    else
      continue;
    end if;
    out := out || jsonb_build_object(r.key, v_id);
  end loop;
  return out;
end $$;

-- Contacts. Rows: [{key, action, id?, account_id?, first_name?, last_name?, title?, email?, phone?, mobile?, notes?}].
create or replace function public.import_contacts(p_batch uuid, p_rows jsonb) returns jsonb language plpgsql as $$
declare
  b    public.import_batch := app.import_batch_for_write(p_batch);
  r    record;
  v_id uuid;
  out  jsonb := '{}'::jsonb;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(
      key text, action text, id uuid, account_id uuid, first_name text, last_name text, title text,
      email text, phone text, mobile text, notes text)
  loop
    v_id := null;
    if r.account_id is not null and not exists (select 1 from public.account where id = r.account_id and tenant_id = b.tenant_id) then
      raise exception 'contact''s company is not in this tenant' using errcode = '23514';
    end if;
    if r.action = 'link' then
      select id into v_id from public.contact where id = r.id and tenant_id = b.tenant_id;
      if v_id is null then raise exception 'contact to link no longer exists' using errcode = 'P0002'; end if;
    elsif r.action = 'create' then
      if coalesce(trim(r.first_name), '') = '' and coalesce(trim(r.last_name), '') = '' and coalesce(trim(r.email), '') = '' then
        raise exception 'a contact needs a name or an email' using errcode = '22023';
      end if;
      -- A retried chunk (the first attempt committed but its answer was lost) finds its own rows instead of doubling them.
      select id into v_id from public.contact c
       where c.import_batch_id = p_batch
         and ((nullif(trim(r.email), '') is not null and c.email = lower(trim(r.email))::citext)
           or (nullif(trim(r.email), '') is null and c.email is null and c.account_id is not distinct from r.account_id
               and c.full_name is not distinct from nullif(trim(coalesce(trim(r.first_name), '') || ' ' || coalesce(trim(r.last_name), '')), '')))
       limit 1;
      if v_id is null then
        insert into public.contact(tenant_id, account_id, first_name, last_name, title, email, phone, mobile, notes, source, created_by, import_batch_id)
        values (b.tenant_id, r.account_id, nullif(trim(r.first_name), ''), nullif(trim(r.last_name), ''), nullif(r.title, ''),
                nullif(lower(trim(r.email)), '')::citext, nullif(r.phone, ''), nullif(r.mobile, ''), nullif(r.notes, ''), 'import', auth.uid(), p_batch)
        returning id into v_id;
      end if;
    else
      continue;
    end if;
    out := out || jsonb_build_object(r.key, v_id);
  end loop;
  return out;
end $$;

-- Properties. Rows: [{key, action, id?, account_id?, party_role?('manager'|'owner'), name?, address1?, city?, state?, zip?,
-- asset_class?, roof_system?, roof_install_year?, roof_area_sf?, unit_count?, notes?, contact_ids?: uuid[]}].
-- A new property with a company gets its current property_party row from the existing machinery:
--   manager → property.account_id on insert (app.on_property_insert_party, source 'import');
--   owner   → an 'owner' property_party row (app.on_party_change keeps property.account_id in sync).
-- contact_ids are linked to the property (new or existing) in property_contact, tagged with the batch.
create or replace function public.import_properties(p_batch uuid, p_rows jsonb) returns jsonb language plpgsql as $$
declare
  b    public.import_batch := app.import_batch_for_write(p_batch);
  r    record;
  v_id uuid;
  v_c  uuid;
  out  jsonb := '{}'::jsonb;
begin
  for r in select * from jsonb_to_recordset(coalesce(p_rows, '[]')) as x(
      key text, action text, id uuid, account_id uuid, party_role text, name text, address1 text, city text, state text, zip text,
      asset_class text, roof_system text, roof_install_year int, roof_area_sf numeric, unit_count int, notes text, contact_ids uuid[])
  loop
    v_id := null;
    if r.account_id is not null and not exists (select 1 from public.account where id = r.account_id and tenant_id = b.tenant_id) then
      raise exception 'property''s company is not in this tenant' using errcode = '23514';
    end if;
    if r.action = 'link' then
      select id into v_id from public.property where id = r.id and tenant_id = b.tenant_id;
      if v_id is null then raise exception 'property to link no longer exists' using errcode = 'P0002'; end if;
    elsif r.action = 'create' then
      if coalesce(trim(r.name), '') = '' and coalesce(trim(r.address1), '') = '' then
        raise exception 'a property needs a name or an address' using errcode = '22023';
      end if;
      if coalesce(trim(r.address1), '') <> '' then
        select id into v_id from public.property
         where tenant_id = b.tenant_id and duplicate_of is null and normalized_address = app.normalize_address(r.address1, r.city)
         order by created_at limit 1;
      else
        select id into v_id from public.property
         where import_batch_id = p_batch and address1 is null and name = trim(r.name) and account_id is not distinct from r.account_id
         limit 1;
      end if;
      if v_id is null then
        insert into public.property(tenant_id, account_id, name, address1, city, state, zip, asset_class, roof_system, roof_install_year,
                                    roof_area_sf, unit_count, notes, source, created_by, import_batch_id)
        values (b.tenant_id, case when coalesce(r.party_role, 'manager') = 'manager' then r.account_id end,
                nullif(trim(r.name), ''), nullif(trim(r.address1), ''), nullif(r.city, ''), nullif(r.state, ''), nullif(r.zip, ''),
                nullif(r.asset_class, ''), nullif(r.roof_system, ''), r.roof_install_year, r.roof_area_sf, r.unit_count, nullif(r.notes, ''),
                'import', auth.uid(), p_batch)
        returning id into v_id;
        if r.account_id is not null and r.party_role = 'owner' then
          insert into public.property_party(tenant_id, property_id, account_id, role, started_on, source, created_by)
          values (b.tenant_id, v_id, r.account_id, 'owner', null, 'import', auth.uid());
        end if;
      end if;
    else
      continue;
    end if;
    if r.contact_ids is not null then
      foreach v_c in array r.contact_ids loop
        if exists (select 1 from public.contact where id = v_c and tenant_id = b.tenant_id) then
          insert into public.property_contact(tenant_id, property_id, contact_id, role, import_batch_id)
          values (b.tenant_id, v_id, v_c, null, p_batch)
          on conflict (property_id, contact_id) do nothing;
        end if;
      end loop;
    end if;
    out := out || jsonb_build_object(r.key, v_id);
  end loop;
  return out;
end $$;

-- Close the batch: created counts are counted from the tagged rows; the client adds linked / skipped / error counts.
create or replace function public.import_finish(p_batch uuid, p_status text, p_counts jsonb, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  b public.import_batch := app.import_batch_for_write(p_batch);
  c jsonb;
begin
  if p_status not in ('done','failed') then raise exception 'bad status' using errcode = '22023'; end if;
  c := coalesce(p_counts, '{}'::jsonb) || jsonb_build_object(
    'accounts_created',   (select count(*) from public.account  where import_batch_id = p_batch),
    'contacts_created',   (select count(*) from public.contact  where import_batch_id = p_batch),
    'properties_created', (select count(*) from public.property where import_batch_id = p_batch),
    'links_created',      (select count(*) from public.property_contact where import_batch_id = p_batch));
  update public.import_batch set status = p_status, counts = c, error = left(p_error, 1000), finished_at = now() where id = p_batch;
  return c;
end $$;

-- Undo within 24 h: delete what the batch created that nothing has been attached to since.
--   property: no touch, task, opportunity, condition flag or field photo;
--   contact:  no touch, task, or opportunity (as primary contact);
--   account:  no touch, task, opportunity, preference, extra assignment, field photo, and nothing left on it
--             (no contact / property / ownership / employment row that is staying).
-- Links the batch created (property_contact) are removed even when both ends stay.
-- SECURITY DEFINER because deletes are owner/admin-only under RLS; managers may undo their tenant's imports.
create or replace function public.import_undo(p_batch uuid) returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  b       public.import_batch;
  v_props uuid[];
  v_cons  uuid[];
  v_accts uuid[];
  v_links int;
  kept    jsonb;
  report  jsonb;
begin
  select * into b from public.import_batch where id = p_batch for update;
  if b.id is null then raise exception 'import not found' using errcode = 'P0002'; end if;
  perform app.require_manager(b.tenant_id);
  if b.status in ('undone','partially_undone') then raise exception 'this import was already undone' using errcode = '22023'; end if;
  if b.created_at < now() - interval '24 hours' then raise exception 'imports can only be undone within 24 hours' using errcode = '22023'; end if;

  select coalesce(array_agg(p.id), '{}') into v_props from public.property p
   where p.import_batch_id = p_batch and p.tenant_id = b.tenant_id
     and not exists (select 1 from public.touch x where x.property_id = p.id)
     and not exists (select 1 from public.task k where k.property_id = p.id)
     and not exists (select 1 from public.opportunity o where o.property_id = p.id)
     and not exists (select 1 from public.property_flag f where f.property_id = p.id);
  -- Field photos (public.photo, added by the field-kit migration) count as attached work too.
  if to_regclass('public.photo') is not null then
    execute 'select coalesce(array_agg(x), ''{}'') from unnest($1) x where not exists (select 1 from public.photo ph where ph.property_id = x)'
      into v_props using v_props;
  end if;

  select coalesce(array_agg(c.id), '{}') into v_cons from public.contact c
   where c.import_batch_id = p_batch and c.tenant_id = b.tenant_id
     and not exists (select 1 from public.touch x where x.contact_id = c.id)
     and not exists (select 1 from public.task k where k.contact_id = c.id)
     and not exists (select 1 from public.opportunity o where o.primary_contact_id = c.id);

  select coalesce(array_agg(a.id), '{}') into v_accts from public.account a
   where a.import_batch_id = p_batch and a.tenant_id = b.tenant_id
     and not exists (select 1 from public.touch x where x.account_id = a.id)
     and not exists (select 1 from public.task k where k.account_id = a.id)
     and not exists (select 1 from public.opportunity o where o.account_id = a.id)
     and not exists (select 1 from public.account_preference ap where ap.account_id = a.id)
     and not exists (select 1 from public.account_assignment aa where aa.account_id = a.id)
     and not exists (select 1 from public.contact c where c.account_id = a.id and not (c.id = any (v_cons)))
     and not exists (select 1 from public.property p where p.account_id = a.id and not (p.id = any (v_props)))
     and not exists (select 1 from public.property_party pp where pp.account_id = a.id and not (pp.property_id = any (v_props)))
     and not exists (select 1 from public.contact_employment ce where ce.account_id = a.id and not (ce.contact_id = any (v_cons)));
  if to_regclass('public.photo') is not null then
    execute 'select coalesce(array_agg(x), ''{}'') from unnest($1) x where not exists (select 1 from public.photo ph where ph.account_id = x)'
      into v_accts using v_accts;
  end if;

  kept := jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name)) from public.account a
                           where a.import_batch_id = p_batch and not (a.id = any (v_accts))), '[]'),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', coalesce(c.full_name, c.email::text))) from public.contact c
                           where c.import_batch_id = p_batch and not (c.id = any (v_cons))), '[]'),
    'properties', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.address1))) from public.property p
                           where p.import_batch_id = p_batch and not (p.id = any (v_props))), '[]'));

  delete from public.property_contact where import_batch_id = p_batch;
  get diagnostics v_links = row_count;
  delete from public.property where id = any (v_props);
  delete from public.contact  where id = any (v_cons);
  delete from public.account  where id = any (v_accts);

  report := jsonb_build_object(
    'deleted', jsonb_build_object('accounts', cardinality(v_accts), 'contacts', cardinality(v_cons),
                                  'properties', cardinality(v_props), 'links', v_links),
    'kept', kept);
  update public.import_batch
     set status = case when jsonb_array_length(kept->'accounts') + jsonb_array_length(kept->'contacts') + jsonb_array_length(kept->'properties') = 0
                       then 'undone' else 'partially_undone' end,
         undone_at = now(), undone_by = auth.uid(), undo_report = report
   where id = p_batch;
  return report;
end $$;

revoke all on function public.import_begin(uuid, text, jsonb, jsonb, int) from public;
revoke all on function public.import_accounts(uuid, jsonb) from public;
revoke all on function public.import_contacts(uuid, jsonb) from public;
revoke all on function public.import_properties(uuid, jsonb) from public;
revoke all on function public.import_finish(uuid, text, jsonb, text) from public;
revoke all on function public.import_undo(uuid) from public;
grant execute on function public.import_begin(uuid, text, jsonb, jsonb, int) to authenticated, service_role;
grant execute on function public.import_accounts(uuid, jsonb) to authenticated, service_role;
grant execute on function public.import_contacts(uuid, jsonb) to authenticated, service_role;
grant execute on function public.import_properties(uuid, jsonb) to authenticated, service_role;
grant execute on function public.import_finish(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.import_undo(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Bulk assign / reassign + audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.account_change (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  account_id  uuid not null references public.account(id) on delete cascade,
  field       text not null check (field in ('owner','tier','preference')),
  old_value   text,
  new_value   text,
  note        text,
  tasks_moved integer not null default 0,
  changed_by  uuid references public.profile(id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists account_change_account_idx on public.account_change(account_id, changed_at desc);
create index if not exists account_change_tenant_idx  on public.account_change(tenant_id, changed_at desc);
alter table public.account_change enable row level security;
drop policy if exists account_change_select on public.account_change;
create policy account_change_select on public.account_change for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
grant select on public.account_change to authenticated;
grant all on public.account_change to service_role;

-- p_changes: any of {"owner_user_id": uuid|null, "icp_tier": 1..4, "preference": code|"none", "reason": text}.
-- Returns {"accounts": n changed, "tasks_moved": m}. All or nothing.
create or replace function public.bulk_update_accounts(p_tenant uuid, p_accounts uuid[], p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  me        uuid := auth.uid();
  a         record;
  v_owner   uuid;
  v_set_own boolean := p_changes ? 'owner_user_id';
  v_tier    int := (p_changes->>'icp_tier')::int;
  v_pref    text := nullif(p_changes->>'preference', '');
  v_reason  text := nullif(trim(p_changes->>'reason'), '');
  v_old     text;
  v_moved   int;
  n_accts   int := 0;
  n_tasks   int := 0;
begin
  perform app.require_manager(p_tenant);
  if cardinality(coalesce(p_accounts, '{}')) = 0 then raise exception 'pick at least one account' using errcode = '22023'; end if;
  if cardinality(p_accounts) > 1000 then raise exception 'at most 1,000 accounts at a time' using errcode = '22023'; end if;
  if v_set_own then
    v_owner := nullif(p_changes->>'owner_user_id', '')::uuid;
    if v_owner is not null and not exists (select 1 from public.membership where tenant_id = p_tenant and user_id = v_owner and active) then
      raise exception 'that rep is not on this team' using errcode = '22023';
    end if;
  end if;
  if v_tier is not null and v_tier not between 1 and 4 then raise exception 'tier must be P1–P4' using errcode = '22023'; end if;
  if v_pref is not null and v_pref <> 'none' and v_pref not in ('pursue','deprioritize','do_not_pursue','competitor','existing_client','partner') then
    raise exception 'unknown preference' using errcode = '22023';
  end if;
  if v_pref in ('do_not_pursue','competitor') and v_reason is null then
    raise exception 'say why — the team will see it on the account' using errcode = '22023';
  end if;

  for a in select id, owner_user_id, icp_tier from public.account
            where tenant_id = p_tenant and id = any (p_accounts) and duplicate_of is null
            for update
  loop
    n_accts := n_accts + 1;
    if v_set_own and a.owner_user_id is distinct from v_owner then
      update public.account set owner_user_id = v_owner where id = a.id;
      v_moved := 0;
      if v_owner is not null then
        -- Tasks follow the account owner: the previous owner's (or nobody's) open tasks on the account and its people.
        update public.task k set assignee_user_id = v_owner
         where k.tenant_id = p_tenant and k.status = 'open'
           and (k.assignee_user_id is null or k.assignee_user_id = a.owner_user_id)
           and (k.account_id = a.id or k.contact_id in (select c.id from public.contact c where c.account_id = a.id));
        get diagnostics v_moved = row_count;
      end if;
      n_tasks := n_tasks + v_moved;
      insert into public.account_change(tenant_id, account_id, field, old_value, new_value, tasks_moved, changed_by)
      values (p_tenant, a.id, 'owner', a.owner_user_id::text, v_owner::text, v_moved, me);
    end if;
    if v_tier is not null and a.icp_tier <> v_tier then
      update public.account set icp_tier = v_tier where id = a.id;
      insert into public.account_change(tenant_id, account_id, field, old_value, new_value, changed_by)
      values (p_tenant, a.id, 'tier', a.icp_tier::text, v_tier::text, me);
    end if;
    if v_pref is not null then
      select preference into v_old from public.account_preference where tenant_id = p_tenant and account_id = a.id;
      if v_pref = 'none' then
        delete from public.account_preference where tenant_id = p_tenant and account_id = a.id;
      else
        insert into public.account_preference(tenant_id, account_id, preference, reason, set_by, set_at)
        values (p_tenant, a.id, v_pref, v_reason, me, now())
        on conflict (tenant_id, account_id) do update set preference = excluded.preference, reason = excluded.reason,
               set_by = excluded.set_by, set_at = excluded.set_at, expires_on = null;
      end if;
      if v_old is distinct from nullif(v_pref, 'none') then
        insert into public.account_change(tenant_id, account_id, field, old_value, new_value, note, changed_by)
        values (p_tenant, a.id, 'preference', v_old, nullif(v_pref, 'none'), v_reason, me);
      end if;
    end if;
  end loop;
  return jsonb_build_object('accounts', n_accts, 'tasks_moved', n_tasks);
end $$;
revoke all on function public.bulk_update_accounts(uuid, uuid[], jsonb) from public;
grant execute on function public.bulk_update_accounts(uuid, uuid[], jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) Scorecard
-- ---------------------------------------------------------------------------
alter table public.account add column if not exists paperwork_at timestamptz;
create index if not exists account_paperwork_idx on public.account(tenant_id, paperwork_at) where paperwork_at is not null;

-- First time an account reaches paperwork_received or later. Migrated V2 rows that arrive already there carry no date
-- (unknown), so they don't count toward any month; a migrated account that progresses later is stamped then.
create or replace function app.stamp_paperwork() returns trigger language plpgsql as $$
begin
  if new.paperwork_at is null
     and new.onboarding_status in ('paperwork_received','paperwork_finished','compliant')
     and ((tg_op = 'INSERT' and new.source <> 'dillyv2') or (tg_op = 'UPDATE' and old.onboarding_status is distinct from new.onboarding_status)) then
    new.paperwork_at := now();
  end if;
  return new;
end $$;
drop trigger if exists account_paperwork_stamp on public.account;
create trigger account_paperwork_stamp before insert or update of onboarding_status on public.account
  for each row execute function app.stamp_paperwork();

-- Weekly (last p_weeks Monday-weeks, tenant-local) and monthly (this + last month) counts per user.
--   meetings      = qualified meetings: touches with outcome scheduled_inspection or met_decision_maker, or a
--                   meeting / roof walk / inspection where someone was actually met (not not_there / no_answer /
--                   voicemail / gatekeeper / not_interested). One per touch.
--   in_person     = touches on an in-person channel (door knock, site visit, inspection, roof walk, lunch & learn,
--                   event, meeting) — same definition as Pace.
--   first_touches = touches flagged is_first_touch (first touch ever on the account).
--   fu_due/fu_done = tasks (not dropped) due in the period, and how many of them are done — same as Pace.
--   paperwork     = accounts whose paperwork_at falls in the period, credited to the account owner.
-- Voided touches never count. SECURITY INVOKER: RLS applies.
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
           (x.outcome in ('scheduled_inspection','met_decision_maker')
             or (x.channel in ('meeting','roof_walk','inspection')
                 and x.outcome not in ('not_there','no_answer','voicemail','gatekeeper','not_interested','bounced','auto_reply')))::int as meetings,
           (x.channel in ('door_knock','site_visit','inspection','roof_walk','lunch_and_learn','event','meeting'))::int as in_person,
           x.is_first_touch::int as first_touches, 0 as fu_due, 0 as fu_done, 0 as paperwork
      from public.touch x cross join lo
     where x.tenant_id = p_tenant and x.voided_at is null and x.user_id is not null and x.occurred_at >= lo.ts0
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
