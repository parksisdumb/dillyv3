-- Dilly — CRM core: accounts, contacts, properties, opportunities, targeting.
-- Conventions on every row: tenant_id, source, legacy_table/legacy_id (Dilly V2 traceability), is_test, created_at/updated_at.

-- Allowed vocabularies live in lookup tables so they can grow without migrations on enums.
create table public.vocab (
  domain  text not null,           -- account_type, channel, outcome, service_line, stage, persona_role, onboarding_status, preference
  code    text not null,
  label   text not null,
  sort    int  not null default 100,
  meta    jsonb not null default '{}'::jsonb,
  primary key (domain, code)
);

-- Integrity lives in domains (alterable with ALTER DOMAIN); `vocab` only carries labels/sort for the UI.
create domain app.account_type as text check (value in (
  'owner','property_mgmt','facilities','asset_mgmt','reit','institutional','gc','developer','broker','consultant',
  'architect','government','education','healthcare','industrial','retail','hospitality','religious','vendor','other'));
create domain app.onboarding_status as text check (value in (
  'none','initial_touch','paperwork_started','paperwork_received','paperwork_finished','compliant'));
create domain app.persona_role as text check (value in (
  'economic_buyer','evaluator','initiator','influencer','gatekeeper','user','unknown'));
create domain app.service_line as text check (value in (
  'inspection','repair','maintenance','emergency','re_roof','re_cover','coating','new_construction',
  'tenant_improvement','envelope','insurance_claim','other'));
create domain app.stage as text check (value in (
  'lead','contacted','inspection_scheduled','inspection_complete','proposal_sent','negotiation','won','lost'));
create domain app.preference as text check (value in (
  'pursue','deprioritize','do_not_pursue','competitor','existing_client','partner'));
create domain app.channel as text check (value in (
  'call','email','text','door_knock','site_visit','inspection','roof_walk','lunch_and_learn','event','linkedin','mail','meeting','other'));
create domain app.outcome as text check (value in (
  'connected','voicemail','no_answer','gatekeeper','not_interested','call_back_later','scheduled_inspection',
  'bid_requested','bid_submitted','won','lost','sent','replied','bounced','met_in_person','not_there',
  'met_decision_maker','auto_reply','other'));

-- ---------------------------------------------------------------------------
create table public.account (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant(id) on delete cascade,
  name               text not null,
  normalized_name    text generated always as (app.normalize_name(name)) stored,
  account_type       app.account_type not null default 'other',
  website            text,
  phone              text,
  address1           text, city text, state text, zip text,
  market_id          uuid references public.market(id),
  icp_tier           smallint not null default 3 check (icp_tier between 1 and 4),   -- P1..P4
  score              numeric(6,2) not null default 0,
  score_reasons      jsonb not null default '[]'::jsonb,
  onboarding_status  app.onboarding_status not null default 'none',
  owner_user_id      uuid references public.profile(id),
  last_touch_at      timestamptz,
  first_touch_at     timestamptz,
  notes              text,
  source             text not null default 'rep' check (source in ('rep','field','import','enrichment','agent','dillyv2','roofmachine','federal_bids','dillyintel')),
  external_ref       text,
  legacy_table       text,
  legacy_id          text,
  is_test            boolean not null default false,
  duplicate_of       uuid references public.account(id),
  created_by         uuid references public.profile(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index account_legacy_uq on public.account(tenant_id, legacy_table, legacy_id) where legacy_id is not null;
create index account_tenant_idx on public.account(tenant_id);
create index account_name_trgm on public.account using gin (normalized_name gin_trgm_ops);
create index account_owner_idx on public.account(tenant_id, owner_user_id);
create trigger account_updated before update on public.account for each row execute function app.touch_updated_at();

-- Additional reps working an account (owner_user_id is the primary).
create table public.account_assignment (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  account_id uuid not null references public.account(id) on delete cascade,
  user_id    uuid not null references public.profile(id) on delete cascade,
  role       text not null default 'support' check (role in ('owner','support')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

-- ---------------------------------------------------------------------------
create table public.contact (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  account_id       uuid references public.account(id) on delete set null,
  first_name       text,
  last_name        text,
  full_name        text generated always as (nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), '')) stored,
  title            text,
  persona_role     app.persona_role not null default 'unknown',
  email            citext,
  phone            text,
  mobile           text,
  linkedin_url     text,
  email_status     text not null default 'unknown' check (email_status in ('unknown','verified','risky','bounced')),
  consent_sms      boolean not null default false,
  consent_method   text,
  consent_at       timestamptz,
  do_not_contact   boolean not null default false,
  last_touch_at    timestamptz,
  notes            text,
  source           text not null default 'rep' check (source in ('rep','field','import','enrichment','agent','dillyv2','inbound')),
  source_image_path text,                    -- business-card photo for field captures
  legacy_table     text,
  legacy_id        text,
  is_test          boolean not null default false,
  duplicate_of     uuid references public.contact(id),
  created_by       uuid references public.profile(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index contact_legacy_uq on public.contact(tenant_id, legacy_table, legacy_id) where legacy_id is not null;
create index contact_account_idx on public.contact(account_id);
create index contact_email_idx on public.contact(tenant_id, email);
create index contact_name_trgm on public.contact using gin (lower(full_name) gin_trgm_ops);
create trigger contact_updated before update on public.contact for each row execute function app.touch_updated_at();

-- ---------------------------------------------------------------------------
create table public.property (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenant(id) on delete cascade,
  account_id          uuid references public.account(id) on delete set null,     -- managing / owning account in this tenant's book
  name                text,
  address1            text, city text, state text, zip text,
  normalized_address  text generated always as (app.normalize_address(address1, city)) stored,
  lat                 numeric(9,6),
  lng                 numeric(9,6),
  market_id           uuid references public.market(id),
  asset_class         text,                 -- multifamily, industrial, retail, office, k12, healthcare, ...
  roof_system         text,                 -- TPO, EPDM, PVC, mod_bit, BUR, metal, shingle, coating, ...
  roof_area_sf        numeric(12,0),
  roof_install_year   smallint,
  warranty_expires_on date,
  building_count      int,
  notes               text,
  external_ref        text,                 -- roofmachine / DillyIntel id
  source              text not null default 'rep' check (source in ('rep','field','import','enrichment','agent','dillyv2','roofmachine','dillyintel','federal_bids')),
  legacy_table        text,
  legacy_id           text,
  is_test             boolean not null default false,
  duplicate_of        uuid references public.property(id),
  created_by          uuid references public.profile(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index property_legacy_uq on public.property(tenant_id, legacy_table, legacy_id) where legacy_id is not null;
create index property_account_idx on public.property(account_id);
create index property_addr_idx on public.property(tenant_id, normalized_address);
create trigger property_updated before update on public.property for each row execute function app.touch_updated_at();

create table public.property_contact (
  tenant_id   uuid not null references public.tenant(id) on delete cascade,
  property_id uuid not null references public.property(id) on delete cascade,
  contact_id  uuid not null references public.contact(id) on delete cascade,
  role        text,
  primary key (property_id, contact_id)
);

-- ---------------------------------------------------------------------------
create table public.opportunity (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenant(id) on delete cascade,
  account_id            uuid references public.account(id) on delete set null,
  property_id           uuid references public.property(id) on delete set null,
  primary_contact_id    uuid references public.contact(id) on delete set null,
  name                  text not null,
  service_line          app.service_line not null default 'repair',
  stage                 app.stage not null default 'lead',
  value_estimate        numeric(14,2),
  gross_profit_estimate numeric(14,2),
  next_step             text,
  next_step_due         date,
  owner_user_id         uuid references public.profile(id),
  stage_changed_at      timestamptz not null default now(),
  won_at                timestamptz,
  lost_at               timestamptz,
  lost_reason           text,
  source                text not null default 'rep' check (source in ('rep','field','inbound','agent','dillyv2','federal_bids','import')),
  legacy_table          text,
  legacy_id             text,
  is_test               boolean not null default false,
  created_by            uuid references public.profile(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index opportunity_legacy_uq on public.opportunity(tenant_id, legacy_table, legacy_id) where legacy_id is not null;
create index opportunity_tenant_stage_idx on public.opportunity(tenant_id, stage);
create trigger opportunity_updated before update on public.opportunity for each row execute function app.touch_updated_at();

create or replace function app.opportunity_stage_stamp() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'won'  and new.won_at  is null then new.won_at  := now(); end if;
    if new.stage = 'lost' and new.lost_at is null then new.lost_at := now(); end if;
  end if;
  return new;
end $$;
create trigger opportunity_stage before update on public.opportunity for each row execute function app.opportunity_stage_stamp();

-- ---------------------------------------------------------------------------
-- Per-tenant targeting (what this contractor pursues) and per-account overrides.
-- ---------------------------------------------------------------------------
create table public.tenant_targeting (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  dimension  text not null check (dimension in ('service_line','asset_class','account_type','market')),
  value      text not null,
  mode       text not null default 'include' check (mode in ('include','exclude')),
  weight     numeric(4,2) not null default 1.0 check (weight >= 0),
  note       text,
  updated_by uuid references public.profile(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, dimension, value)
);

create table public.account_preference (
  tenant_id  uuid not null references public.tenant(id) on delete cascade,
  account_id uuid not null references public.account(id) on delete cascade,
  preference app.preference not null,
  reason     text,
  expires_on date,
  set_by     uuid references public.profile(id),
  set_at     timestamptz not null default now(),
  primary key (tenant_id, account_id)
);

-- Shared and tenant-specific signals (storm, permit, sale, bid posting, inbound reply...).
create table public.signal (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid references public.tenant(id) on delete cascade,  -- null = shared market intel
  market_id    uuid references public.market(id),
  account_id   uuid references public.account(id) on delete cascade,
  property_id  uuid references public.property(id) on delete cascade,
  kind         text not null,
  headline     text not null,
  payload      jsonb not null default '{}'::jsonb,
  weight       numeric(4,2) not null default 1.0,
  occurred_at  timestamptz not null default now(),
  expires_at   timestamptz,
  source       text not null,
  created_at   timestamptz not null default now()
);
create index signal_tenant_idx on public.signal(tenant_id, occurred_at desc);
