-- Dilly — foundation: tenancy, people, markets, segments.
-- Every tenant-scoped table carries tenant_id and is protected by RLS (see 20261003000600_rls.sql).

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

create schema if not exists app;      -- helper functions, business rules
create schema if not exists legacy;   -- raw Dilly V2 copy lands here (never transformed in place)

-- ---------------------------------------------------------------------------
-- Utilities
-- ---------------------------------------------------------------------------
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- Lowercase, strip punctuation, collapse whitespace, drop common company suffixes.
create or replace function app.normalize_name(t text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(
           regexp_replace(lower(coalesce(t,'')), '[^a-z0-9 ]', ' ', 'g'),
           '\m(inc|llc|ltd|co|corp|corporation|company|the|lp|llp)\M|\s+', ' ', 'g')), '')
$$;

-- Street-address normalizer used for duplicate detection (St/Street, Dr/Drive, etc.).
create or replace function app.normalize_address(addr text, city text) returns text language sql immutable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(lower(coalesce(addr,'') || ' ' || coalesce(city,'')), '[^a-z0-9 ]', ' ', 'g'),
      '\mstreet\M','st','g'), '\mdrive\M','dr','g'), '\mavenue\M','ave','g'), '\mroad\M','rd','g'),
      '\mboulevard\M','blvd','g'), '\mparkway\M','pkwy','g'), '\mhighway\M','hwy','g'), '\mlane\M','ln','g'),
    '\s+', ' ', 'g')), '')
$$;

create or replace function app.add_business_days(d date, n int) returns date language plpgsql immutable as $$
declare r date := d; i int := 0;
begin
  if n <= 0 then return d; end if;
  while i < n loop
    r := r + 1;
    if extract(isodow from r) < 6 then i := i + 1; end if;
  end loop;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
create table public.tenant (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name          text not null,
  brand_name    text,
  kind          text not null default 'client' check (kind in ('own','client','demo')),
  timezone      text not null default 'America/Chicago',
  email_provider text check (email_provider in ('google','microsoft')),
  service_note  text,                                -- e.g. "repair/service-led, sub-based"
  settings      jsonb not null default '{}'::jsonb,  -- quiet hours, weekend reminders, digest, etc.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger tenant_updated before update on public.tenant for each row execute function app.touch_updated_at();

create table public.profile (
  id                 uuid primary key references auth.users(id) on delete cascade,
  email              citext not null unique,
  full_name          text,
  phone              text,
  is_platform_admin  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger profile_updated before update on public.profile for each row execute function app.touch_updated_at();

create table public.membership (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  user_id       uuid not null references public.profile(id) on delete cascade,
  role          text not null check (role in ('owner','admin','manager','rep','estimator','pm','reviewer')),
  title         text,
  daily_first_touch_target int not null default 15,
  daily_follow_up_target   int,                     -- null = "whatever the queue says is due"
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index membership_user_idx on public.membership(user_id);

-- Invites turn into memberships on first sign-in (see app.claim_invites()).
create table public.invite (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  email       citext not null,
  role        text not null check (role in ('owner','admin','manager','rep','estimator','pm','reviewer')),
  full_name   text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (tenant_id, email)
);

-- ---------------------------------------------------------------------------
-- Markets (shared intelligence) and tenant coverage
-- ---------------------------------------------------------------------------
create table public.market (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  state       text not null,
  timezone    text not null default 'America/Chicago',
  center_lat  numeric(9,6),
  center_lng  numeric(9,6),
  created_at  timestamptz not null default now()
);

create table public.tenant_market (
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  market_id   uuid not null references public.market(id) on delete restrict,
  role        text not null default 'primary' check (role in ('primary','secondary','travel')),
  launched_on date,
  annual_target_usd numeric(14,2),
  primary key (tenant_id, market_id)
);

-- Segment = market × asset class × buyer type × service line. The config key every agent run carries.
create table public.segment (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  market_id     uuid references public.market(id),
  name          text not null,
  asset_class   text,
  buyer_type    text,
  service_line  text,
  playbook      text not null default 'owner_repair' check (playbook in ('owner_repair','gc_bid_list','institutional','storm')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (tenant_id, name)
);
