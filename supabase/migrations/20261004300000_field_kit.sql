-- Dilly — field kit: photos, card-scan agent, geocoding columns, Storage bucket + policies. Additive only.
--
--   * public.photo — every roof/site photo, on the building (and the touch it was logged with, if any).
--     Photos logged with a touch arrive in touch.media; the touch_media trigger copies them here, so a
--     replayed offline log (same idempotency key → same touch) and its photos land exactly once.
--   * property.geocoded_at / geocode_source — US Census geocoder cache (lat/lng already exist). Changing the
--     address clears the pin so the batch geocoder picks the building up again.
--   * agent 'card-scan' — one agent_run per business-card scan (cost tracking).
--   * Storage bucket 'media' (private) + storage.objects policies keyed on the first path segment
--     (<tenant_id>/yyyy/mm/<uuid>.jpg). Guarded: a no-op on plain Postgres (local tests) where the storage
--     schema doesn't exist, and a NOTICE (not a failure) if the role can't manage storage policies.

-- ---------------------------------------------------------------------------
-- 1) Geocoding columns on property
-- ---------------------------------------------------------------------------
alter table public.property add column if not exists geocoded_at timestamptz;
alter table public.property add column if not exists geocode_source text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'property_geocode_source_chk') then
    alter table public.property add constraint property_geocode_source_chk
      check (geocode_source is null or geocode_source in ('census','census_nomatch','census_error','manual','import','device'));
  end if;
end $$;

-- The batch geocoder's work list: buildings with an address and no pin that haven't been tried (or errored a while ago).
create index if not exists property_geocode_todo_idx on public.property(created_at)
  where lat is null and address1 is not null;
-- Nearby sort: bounding-box prefilter.
create index if not exists property_latlng_idx on public.property(tenant_id, lat, lng) where lat is not null;

-- An address edit invalidates the cached pin (unless the same update sets new coordinates).
create or replace function app.property_geocode_reset() returns trigger language plpgsql as $$
begin
  if (new.address1, new.city, new.state, new.zip) is distinct from (old.address1, old.city, old.state, old.zip)
     and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
    new.lat := null;
    new.lng := null;
    new.geocoded_at := null;
    new.geocode_source := null;
  end if;
  return new;
end $$;
drop trigger if exists property_geocode_reset on public.property;
create trigger property_geocode_reset before update of address1, city, state, zip on public.property
  for each row execute function app.property_geocode_reset();

-- ---------------------------------------------------------------------------
-- 2) Photos
-- ---------------------------------------------------------------------------
create table if not exists public.photo (
  id          uuid primary key,                 -- client-generated: a replayed upload/log is idempotent
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  property_id uuid references public.property(id) on delete set null,
  account_id  uuid references public.account(id) on delete set null,
  touch_id    uuid references public.touch(id) on delete set null,
  path        text not null unique,             -- storage key: <tenant_id>/yyyy/mm/<uuid>.jpg
  caption     text check (caption is null or char_length(caption) <= 300),
  taken_at    timestamptz,
  lat         numeric(9,6),                     -- only when the rep allowed location; EXIF GPS is always stripped
  lng         numeric(9,6),
  width       int,
  height      int,
  created_by  uuid references public.profile(id),
  created_at  timestamptz not null default now(),
  check (split_part(path, '/', 1) = tenant_id::text)
);
create index if not exists photo_property_idx on public.photo(property_id, created_at desc) where property_id is not null;
create index if not exists photo_tenant_idx on public.photo(tenant_id, created_at desc);
create index if not exists photo_touch_idx on public.photo(touch_id) where touch_id is not null;

-- Only the caption may change (plus the ON DELETE SET NULL links when a touch / building / account goes away).
create or replace function app.photo_guard() returns trigger language plpgsql as $$
begin
  if (new.id, new.tenant_id, new.path, new.created_by, new.created_at, new.taken_at)
     is distinct from (old.id, old.tenant_id, old.path, old.created_by, old.created_at, old.taken_at)
     or (new.touch_id is distinct from old.touch_id and new.touch_id is not null) then
    raise exception 'only a photo''s caption can change' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists photo_guard on public.photo;
create trigger photo_guard before update on public.photo for each row execute function app.photo_guard();

alter table public.photo enable row level security;
drop policy if exists photo_select on public.photo;
create policy photo_select on public.photo for select to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
drop policy if exists photo_insert on public.photo;
create policy photo_insert on public.photo for insert to authenticated
  with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]) and created_by = auth.uid());
drop policy if exists photo_update on public.photo;
create policy photo_update on public.photo for update to authenticated
  using (tenant_id = any ((select app.my_tenant_ids())::uuid[])
         and (created_by = auth.uid() or app.has_role(tenant_id, array['owner','admin','manager'])))
  with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]));
grant select, insert, update on public.photo to authenticated;
grant all on public.photo to service_role;

-- Photos logged with a touch (touch.media, kind 'photo') become photo rows on the building.
-- SECURITY DEFINER: the touch insert already passed RLS; only paths inside the touch's tenant are accepted.
-- A malformed media item never blocks the touch (the log matters more than the photo row).
create or replace function app.on_touch_media() returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  begin
    insert into public.photo(id, tenant_id, property_id, account_id, touch_id, path, caption, taken_at, lat, lng, width, height, created_by)
    select (m->>'id')::uuid, new.tenant_id, new.property_id, new.account_id, new.id, m->>'path',
           nullif(left(m->>'caption', 300), ''),
           coalesce((m->>'taken_at')::timestamptz, new.occurred_at),
           (m->>'lat')::numeric, (m->>'lng')::numeric, (m->>'width')::int, (m->>'height')::int, new.user_id
      from jsonb_array_elements(new.media) m
     where m->>'kind' = 'photo'
       and m->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and split_part(m->>'path', '/', 1) = new.tenant_id::text
    on conflict do nothing;
  exception when others then
    raise warning 'touch % media not copied to photo: %', new.id, sqlerrm;
  end;
  return null;
end $$;
drop trigger if exists touch_media on public.touch;
create trigger touch_media after insert on public.touch
  for each row when (jsonb_typeof(new.media) = 'array' and jsonb_array_length(new.media) > 0)
  execute function app.on_touch_media();

-- ---------------------------------------------------------------------------
-- 3) Card-scan agent (agent_run per scan → cost in the Observability view)
-- ---------------------------------------------------------------------------
insert into public.agent(key, name, pod, description, default_tier, enabled) values
  ('card-scan', 'Business-card scan', 3, 'Reads a business-card photo into contact fields for the rep to confirm', 'sonnet', true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Supabase Storage: private bucket 'media' + tenant-scoped object policies.
--    No-op without the storage schema (plain Postgres test databases).
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present — skipping media bucket and policies';
    return;
  end if;
  begin
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
               values ('media', 'media', false, 10485760, array['image/jpeg','image/png','image/webp'])
               on conflict (id) do nothing$q$;
    execute 'drop policy if exists dilly_media_select on storage.objects';
    execute 'drop policy if exists dilly_media_insert on storage.objects';
    execute 'drop policy if exists dilly_media_update on storage.objects';
    -- First path segment = a tenant the user belongs to (platform admins: every tenant), via the cheap InitPlan form.
    execute $q$create policy dilly_media_select on storage.objects for select to authenticated
               using (bucket_id = 'media' and split_part(name, '/', 1) = any ((select app.my_tenant_ids())::text[]))$q$;
    execute $q$create policy dilly_media_insert on storage.objects for insert to authenticated
               with check (bucket_id = 'media' and split_part(name, '/', 1) = any ((select app.my_tenant_ids())::text[]))$q$;
    -- Upsert (a replayed upload of the same photo id) needs update as well.
    execute $q$create policy dilly_media_update on storage.objects for update to authenticated
               using (bucket_id = 'media' and split_part(name, '/', 1) = any ((select app.my_tenant_ids())::text[]))
               with check (bucket_id = 'media' and split_part(name, '/', 1) = any ((select app.my_tenant_ids())::text[]))$q$;
  exception when insufficient_privilege then
    raise notice 'no privilege to manage storage policies — create bucket "media" and its policies in the dashboard (RUNBOOK §12)';
  end;
end $$;
