-- Synthetic Dilly V2 database (best-guess shape from the Sep 13, 2026 app review) with FOX-like data.
-- Loaded into a separate local database that plays the role of the V2 Supabase project in tests.
-- Deterministic: no random(), fixed timestamps.
create extension if not exists pgcrypto;
create schema if not exists extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists citext schema extensions;

create schema if not exists auth;
create table auth.users (id uuid primary key, email text unique, encrypted_password text, created_at timestamptz default now());
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

create type public.user_role as enum ('rep', 'manager', 'admin');
create type public.touch_type as enum ('Call', 'Email', 'Text', 'Door Knock', 'Site Visit', 'Inspection');
create type public.opportunity_stage as enum ('Lead', 'Contacted', 'Inspection Scheduled', 'Proposal Sent', 'Negotiation', 'Won', 'Lost');

create table public.organizations (id uuid primary key default extensions.uuid_generate_v4(), name text not null, created_at timestamptz default now());
create table public.profiles (
  id uuid primary key references auth.users(id), org_id uuid references public.organizations(id),
  email extensions.citext not null, full_name text, role public.user_role not null default 'rep', points int not null default 0,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.accounts (
  id uuid primary key default extensions.uuid_generate_v4(), org_id uuid not null references public.organizations(id),
  name text, type text, website text, phone text, address text, city text, state text, zip text,
  priority text check (priority in ('P1','P2','P3','P4')), score numeric(6,2), onboarding_status text, status text default 'active',
  assigned_to uuid references public.profiles(id), notes text, created_by uuid references public.profiles(id),
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.contacts (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  account_id uuid references public.accounts(id), first_name text, last_name text, title text,
  email extensions.citext, phone text, mobile text, notes text, created_by uuid references public.profiles(id),
  created_at timestamptz default now(), updated_at timestamptz default now(),
  full_name text generated always as (trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))) stored);
create table public.properties (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  account_id uuid references public.accounts(id), name text, address text, city text, state text, zip text,
  property_type text, roof_type text, sqft int, buildings int, notes text, created_by uuid references public.profiles(id),
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.property_contacts (
  property_id uuid not null references public.properties(id), contact_id uuid not null references public.contacts(id),
  role text, created_at timestamptz default now(), primary key (property_id, contact_id));
create table public.opportunities (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  account_id uuid references public.accounts(id), property_id uuid references public.properties(id), contact_id uuid references public.contacts(id),
  name text, type text, stage public.opportunity_stage not null default 'Lead', value numeric(12,2), notes text,
  assigned_to uuid references public.profiles(id), created_by uuid references public.profiles(id),
  stage_updated_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.touchpoints (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  account_id uuid references public.accounts(id), contact_id uuid references public.contacts(id),
  property_id uuid references public.properties(id), opportunity_id uuid references public.opportunities(id),
  user_id uuid references public.profiles(id), type public.touch_type not null, outcome text, direction text default 'outbound',
  notes text, source text default 'manual', gmail_message_id text, gmail_thread_id text, points int default 0,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id),
  account_id uuid references public.accounts(id), contact_id uuid references public.contacts(id),
  property_id uuid references public.properties(id), touchpoint_id uuid references public.touchpoints(id),
  assigned_to uuid references public.profiles(id), title text, notes text, due_date date, status text default 'pending',
  snooze_count int default 0, completed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.territories (id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id), name text, zips text[]);
create table public.prospects (id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id), territory_id uuid references public.territories(id), name text, address text);
create table public.gmail_tokens (user_id uuid primary key references public.profiles(id), access_token text, refresh_token text, expires_at timestamptz);

create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger touchpoints_updated before update on public.touchpoints for each row execute function public.set_updated_at();
create trigger contacts_updated before update on public.contacts for each row execute function public.set_updated_at();
alter table public.accounts enable row level security;
create policy accounts_org on public.accounts for all to authenticated using (org_id in (select org_id from public.profiles where id = auth.uid()));
create view public.leaderboard as select p.full_name, sum(t.points) as pts from public.touchpoints t join public.profiles p on p.id = t.user_id group by 1;
grant all on all tables in schema public to authenticated, anon;

-- ---------------------------------------------------------------------------------------------- data
insert into public.organizations(id, name, created_at) values
  ('0f0f0000-0000-4000-8000-000000000001', 'FOX Roofing', '2025-11-01Z'),
  ('0f0f0000-0000-4000-8000-000000000002', 'Demo Org', '2025-11-01Z');

create temporary table u(n int, id uuid, email text, full_name text, role public.user_role, points int);
insert into u values
  (0, '00000000-0000-4000-8000-0000000000a0', 'parks@foxroofing.co', 'Parks Flowers', 'admin', 120),
  (1, '00000000-0000-4000-8000-0000000000a1', 'tyler@foxroofing.co', 'Tyler Fox', 'manager', 85),
  (2, '00000000-0000-4000-8000-0000000000a2', 'ben@foxroofing.co', 'Ben Mitchell', 'rep', 240),
  (3, '00000000-0000-4000-8000-0000000000a3', 'Colby@FoxRoofing.co', 'Colby Remedios', 'rep', 410),
  (4, '00000000-0000-4000-8000-0000000000a4', 'dylan@foxroofing.co', 'Dylan Kreiser', 'rep', 150),
  (5, '00000000-0000-4000-8000-0000000000a5', 'kayla@foxroofing.co', 'Kayla Smiley', 'rep', 330);
insert into auth.users(id, email, encrypted_password) select id, lower(email), '$2a$10$fakehashfortests' || n from u;
insert into public.profiles(id, org_id, email, full_name, role, points, created_at)
select id, '0f0f0000-0000-4000-8000-000000000001', email, full_name, role, points, '2025-11-02Z' from u;
insert into auth.users(id, email) values ('00000000-0000-4000-8000-0000000000d0', 'demo@example.com');
insert into public.profiles(id, org_id, email, full_name, role) values
  ('00000000-0000-4000-8000-0000000000d0', '0f0f0000-0000-4000-8000-000000000002', 'demo@example.com', 'Demo User', 'admin');

-- 36 FOX accounts
insert into public.accounts(id, org_id, name, type, website, phone, address, city, state, zip, priority, score, onboarding_status, status,
                            assigned_to, notes, created_by, created_at, updated_at)
select md5('acct' || i)::uuid, '0f0f0000-0000-4000-8000-000000000001',
       case when i = 36 then 'CBRE — Austin (address TBD)'
            when i = 35 then 'Greystar — Austin'   -- same as #1: duplicate suggestion, never merged
            else (array['Greystar','Asset Living','Lincoln Property Co','Cushman & Wakefield','RPM Living','Avenue5 Residential','Bell Partners',
                        'Camden Property Trust','Morgan Group','Allied Orion','Embrey Management','Highmark Residential'])[1 + (i - 1) % 12]
                 || ' — ' || (array['Austin','Dallas','San Antonio'])[1 + (i - 1) / 12] end,
       (array['Property Mgmt','Property Mgmt','Owner','Facilities','Asset Mgmt','GC','Developer','Broker','Consultant','Vendor','Other',null])[1 + (i - 1) % 12],
       'https://example' || i || '.com', '512-555-' || lpad(i::text, 4, '0'),
       (100 + i) || ' Congress Ave', (array['Austin','Dallas','San Antonio'])[1 + (i - 1) / 12], 'TX', '787' || lpad(i::text, 2, '0'),
       case when i = 7 then null else 'P' || (1 + i % 4) end, (i * 2.5)::numeric(6,2),
       (array['Initial Touch','Onboarding Paperwork Started','Onboarding Paperwork Received','Onboarding Paperwork Finished',
              'Compliant / Active Vendor', null, null])[1 + i % 7],
       case when i % 17 = 0 then 'do_not_pursue' when i % 13 = 0 then 'existing_client' else 'active' end,
       (select id from u where n = i % 6),
       case when i % 5 = 0 then 'Manages ' || (5 + i) || ' communities; roofs mostly TPO, some out of warranty.' end,
       (select id from u where n = 0),
       '2025-12-01Z'::timestamptz + make_interval(days => i), '2026-08-01Z'::timestamptz + make_interval(days => i % 30)
  from generate_series(1, 36) i;
insert into public.accounts(id, org_id, name, type, priority, created_at) values
  (md5('demo-acct-1')::uuid, '0f0f0000-0000-4000-8000-000000000002', 'Demo Account A', 'Weird Type', 'P1', '2026-01-01Z'),
  (md5('demo-acct-2')::uuid, '0f0f0000-0000-4000-8000-000000000002', 'Demo Account B', 'Owner', 'P2', '2026-01-01Z');

-- 120 FOX contacts (contacts 115..118 duplicate 15..18; contact 119 is an orphan whose account no longer exists)
insert into public.contacts(id, org_id, account_id, first_name, last_name, title, email, phone, mobile, notes, created_by, created_at, updated_at)
select md5('contact' || i)::uuid, '0f0f0000-0000-4000-8000-000000000001',
       md5('acct' || (1 + (src - 1) % 36))::uuid,
       (array['Dave','Maria','James','Priya','Luis','Kendra','Tom','Ashley','Raj','Brenda','Carlos','Nicole'])[1 + (src - 1) % 12],
       (array['Lopez','Nguyen','Patel','Johnson','Garcia','Smith','Brown','Davis','Martinez','Wilson'])[1 + (src - 1) % 10],
       (array['Property Manager','Regional Manager','Chief Engineer','Maintenance Supervisor','Leasing Agent','VP Asset Management'])[1 + (src - 1) % 6],
       'contact' || src || '@example.com', '512-555-' || lpad((1000 + src)::text, 4, '0'),
       case when src % 3 = 0 then '737-555-' || lpad((2000 + src)::text, 4, '0') end,
       case when i = 60 then 'Follow up — test 3 test 3'
            when i % 9 = 0 then 'PM in a meeting, leasing agent gave me PM contact. Ask about the clubhouse roof — “ponding” after rain.' end,
       (select id from u where n = i % 6),
       '2026-01-05Z'::timestamptz + make_interval(days => i % 60, hours => i % 24), '2026-08-15Z'::timestamptz
  from (select i, case when i between 115 and 118 then i - 100 else i end as src from generate_series(1, 120) i) s
 where i <> 119;
set session_replication_role = replica;   -- V2 has rows with broken FKs; reproduce one (FK checks off for this insert only)
insert into public.contacts(id, org_id, account_id, first_name, last_name, title, email, created_at)
values (md5('contact119')::uuid, '0f0f0000-0000-4000-8000-000000000001', md5('deleted-account')::uuid, 'Orphan', 'Contact', 'Owner',
        'orphan@example.com', '2026-02-01Z');
set session_replication_role = origin;
insert into public.contacts(id, org_id, account_id, first_name, last_name, email, created_at) values
  (md5('demo-contact-1')::uuid, '0f0f0000-0000-4000-8000-000000000002', md5('demo-acct-1')::uuid, 'Demo', 'Person', 'demo-person@example.com', '2026-01-02Z');

-- 100 properties (every 25th unlinked; #50 is a test row; #99 duplicates #9's address)
insert into public.properties(id, org_id, account_id, name, address, city, state, zip, property_type, roof_type, sqft, buildings, notes, created_by, created_at, updated_at)
select md5('prop' || i)::uuid, '0f0f0000-0000-4000-8000-000000000001',
       case when i % 25 = 0 then null else md5('acct' || (1 + (i - 1) % 36))::uuid end,
       case when i = 50 then '123 Test 2' else (array['The Grove','Parkside','Riverstone','Oak Hollow','Stonebridge'])[1 + i % 5] || ' at ' || i end,
       case when i = 50 then '123 Test 2' when i = 99 then (300 + 9) || ' Riverside Drive' else (300 + i) || ' Riverside Dr' end,
       (array['Austin','Dallas','San Antonio'])[1 + i % 3], 'TX', '78' || lpad((700 + i)::text, 3, '0'),
       (array['Multifamily','Multifamily','Office','Retail','Industrial'])[1 + i % 5],
       (array['TPO','EPDM','Mod Bit','Shingle',null])[1 + i % 5], 20000 + i * 750, 1 + i % 12,
       case when i % 4 = 0 then 'roof out of warranty, leaks in one building' end,
       (select id from u where n = i % 6),
       '2026-01-10Z'::timestamptz + make_interval(days => i % 80), '2026-08-20Z'::timestamptz
  from generate_series(1, 100) i;

insert into public.property_contacts(property_id, contact_id, role)
select md5('prop' || i)::uuid, md5('contact' || (1 + (i - 1) % 36))::uuid, 'Property Manager' from generate_series(1, 100) i
union all
select md5('prop' || i)::uuid, md5('contact' || (37 + (i - 1) % 36))::uuid, null from generate_series(1, 100) i where i % 3 = 0;

-- 18 opportunities, $372,000: 3 Contacted, 10 Proposal Sent, 5 Negotiation
insert into public.opportunities(id, org_id, account_id, property_id, contact_id, name, type, stage, value, notes, assigned_to, created_by,
                                 stage_updated_at, created_at, updated_at)
select md5('opp' || i)::uuid, '0f0f0000-0000-4000-8000-000000000001',
       md5('acct' || (1 + (i * 5 - 1) % 36))::uuid, md5('prop' || (i * 5))::uuid, md5('contact' || (1 + (i * 5 - 1) % 36))::uuid,
       case when i = 4 then null else 'Roof ' || (array['repair','replacement','maintenance plan','inspection','coating'])[1 + i % 5] || ' #' || i end,
       (array['Repair','Re-Roof','Maintenance','Inspection','Coating'])[1 + i % 5],
       (case when i <= 3 then 'Contacted' when i <= 13 then 'Proposal Sent' else 'Negotiation' end)::public.opportunity_stage,
       (array[48000,42000,36000,32000,28000,26000,24000,22000,20000,18000,16000,14000,12000,11000,9000,6500,4500,3000])[i],
       case when i % 2 = 0 then 'Sent proposal ' || i || ' — waiting on owner approval; budget cycle in Q1.' end,
       (select id from u where n = 2 + i % 4), (select id from u where n = 2 + i % 4),
       '2026-07-01Z'::timestamptz + make_interval(days => i), '2026-06-01Z'::timestamptz + make_interval(days => i), '2026-07-01Z'::timestamptz
  from generate_series(1, 18) i;

-- 300 FOX touchpoints over 90 days (Jun 15 -> Sep 13, 2026) by 6 users; Gmail-sourced emails and inbound auto-replies.
insert into public.touchpoints(id, org_id, account_id, contact_id, property_id, opportunity_id, user_id, type, outcome, direction, notes,
                               source, gmail_message_id, gmail_thread_id, points, created_at, updated_at)
select md5('touch' || i)::uuid, '0f0f0000-0000-4000-8000-000000000001',
       (select a.id from public.accounts a where a.id = c.account_id), c.id,
       case when ty in ('Door Knock','Site Visit','Inspection') then md5('prop' || (1 + i % 100))::uuid end,
       case when i % 50 = 0 then md5('opp' || (1 + i % 18))::uuid end,
       (select id from u where n = i % 6),
       ty::public.touch_type, oc, dir,
       case when i = 77 then repeat('Long site-visit write-up. ', 200)
            when i % 4 = 0 then 'Talked to ' || c.first_name || ' — roof out of warranty, leaks in one building. Línea 2: “quotes”.'
            when i % 7 = 0 then E'Multi-line\nnote ' || i end,
       src, gm, case when gm is not null then 'thread-' || (i / 3) end,
       case when oc like 'Connected%' then 3 when oc like 'Scheduled%' then 10 else 1 end,
       ts, ts
  from (
    select i, ts,
           case when i % 30 = 15 or i % 10 = 0 then 'Email'
                else (array['Call','Call','Email','Text','Door Knock','Site Visit','Inspection'])[1 + i % 7] end as ty,
           case when i % 30 = 15 then 'inbound' else 'outbound' end as dir,
           case when i % 30 = 15 or i % 10 = 0 then 'gmail' else 'manual' end as src,
           case when i = 290 then 'gmail-msg-280' when i % 30 = 15 or i % 10 = 0 then 'gmail-msg-' || i end as gm,
           case when i % 30 = 15 then 'Auto-Reply'
                when i % 10 = 0 then 'Sent'
                else case (array['Call','Call','Email','Text','Door Knock','Site Visit','Inspection'])[1 + i % 7]
                       when 'Call' then (array['Connected — had a conversation','No Answer — left voicemail','Gatekeeper — couldn''t get through',
                                               'Scheduled — booked inspection','No Answer — left voicemail'])[1 + i % 5]
                       when 'Email' then (array['Sent','Got a Reply','Bounced'])[1 + i % 3]
                       when 'Text' then (array['Sent','Got a Reply'])[1 + i % 2]
                       when 'Door Knock' then (array['Met in Person','Not There','Gatekeeper — couldn''t get through'])[1 + i % 3]
                       when 'Site Visit' then (array['Met in Person','Not There'])[1 + i % 2]
                       else (array['Met in Person','Bid Submitted'])[1 + i % 2] end end as oc
      from (select i, '2026-06-15 13:05:00Z'::timestamptz + make_interval(mins => i * 431 + (i % 7) * 17) as ts
              from generate_series(1, 300) i) g
  ) t
  join public.contacts c on c.id = md5('contact' || (1 + (t.i * 7) % 120))::uuid;
insert into public.touchpoints(id, org_id, account_id, contact_id, user_id, type, outcome, direction, created_at) values
  (md5('demo-touch-1')::uuid, '0f0f0000-0000-4000-8000-000000000002', md5('demo-acct-1')::uuid, md5('demo-contact-1')::uuid,
   '00000000-0000-4000-8000-0000000000d0', 'Call', 'Smoke Signal', 'outbound', '2026-07-01Z');

-- Follow-ups: 150 open + overdue (from touches 41..190), 20 completed, 3 dismissed.
insert into public.follow_ups(id, org_id, account_id, contact_id, property_id, touchpoint_id, assigned_to, title, notes, due_date, status,
                              snooze_count, completed_at, created_at, updated_at)
select md5('fu' || t.i)::uuid, t.org_id, t.account_id, t.contact_id, t.property_id, t.id, t.user_id,
       case when t.i = 100 then 'Follow up — test 3 test 3' else 'Follow up with ' || c.first_name || ' ' || c.last_name end,
       case when t.i % 6 = 0 then 'Ask for the regional manager; send capabilities deck.' end,
       (t.created_at + interval '3 days')::date,
       case when t.i <= 20 then 'completed' when t.i <= 23 then 'dismissed' else 'pending' end,
       t.i % 4, case when t.i <= 20 then t.created_at + interval '2 days' end,
       t.created_at + interval '1 minute', t.created_at + interval '1 minute'
  from (select *, row_number() over (order by created_at) as i from public.touchpoints
         where org_id = '0f0f0000-0000-4000-8000-000000000001') t
  join public.contacts c on c.id = t.contact_id
 where t.i <= 23 or t.i between 41 and 190;

insert into public.territories(org_id, name, zips) values ('0f0f0000-0000-4000-8000-000000000001', 'Memphis Test', array['38103','38104']);
insert into public.gmail_tokens(user_id, access_token, refresh_token, expires_at) values
  ('00000000-0000-4000-8000-0000000000a3', 'ya29.fake', 'rt.fake', '2026-09-14Z');
