-- Synthetic Dilly V2 data on the REAL V2 schema (built from v2-schema-snippet.csv by tests/migration/v2-schema.ts).
-- Three orgs: FOX Roofing (migrated) + Acme Roofing Co and Summit Exteriors (must never reach Dilly).
-- Deterministic: ids are md5-derived, timestamps fixed. Edge cases are called out inline.
create or replace function pg_temp.u(text) returns uuid language sql immutable as $$ select md5($1)::uuid $$;

-- ------------------------------------------------------------------------------------------------ orgs & people
insert into public.orgs(id, name, created_at) values
  ('0f0f0000-0000-4000-8000-000000000001', 'FOX Roofing', '2026-01-05T15:00:00Z'),
  ('0f0f0000-0000-4000-8000-000000000002', 'Acme Roofing Co', '2026-02-01T15:00:00Z'),
  ('0f0f0000-0000-4000-8000-000000000003', 'Summit Exteriors', '2026-03-01T15:00:00Z');

insert into auth.users(id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'parks@foxroofing.co'),
  ('00000000-0000-4000-8000-0000000000a2', 'tyler@foxroofing.co'),
  ('00000000-0000-4000-8000-0000000000a3', 'ben@foxroofing.co'),
  ('00000000-0000-4000-8000-0000000000a4', 'Colby@FoxRoofing.co'),
  ('00000000-0000-4000-8000-0000000000a5', 'dylan@foxroofing.co'),
  ('00000000-0000-4000-8000-0000000000a6', 'kayla@foxroofing.co'),
  ('00000000-0000-4000-8000-0000000000a7', null),
  ('00000000-0000-4000-8000-0000000000b1', 'owner@acmeroofing.com'),
  ('00000000-0000-4000-8000-0000000000b2', 'rep@acmeroofing.com'),
  ('00000000-0000-4000-8000-0000000000c1', 'boss@summitexteriors.com');

insert into public.profiles(user_id, full_name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Parks Flowers'), ('00000000-0000-4000-8000-0000000000a2', 'Tyler Fox'),
  ('00000000-0000-4000-8000-0000000000a3', 'Ben Mitchell'), ('00000000-0000-4000-8000-0000000000a4', 'Colby Remedios'),
  ('00000000-0000-4000-8000-0000000000a5', 'Dylan Kreiser'), ('00000000-0000-4000-8000-0000000000a6', 'Kayla Smiley'),
  ('00000000-0000-4000-8000-0000000000a7', 'Sam Ops'),
  ('00000000-0000-4000-8000-0000000000b1', 'Acme Owner'), ('00000000-0000-4000-8000-0000000000b2', 'Acme Rep'),
  ('00000000-0000-4000-8000-0000000000c1', 'Summit Boss');

-- Colby's V2 email is mixed case; Parks is also a member of Acme (must only get his FOX role).
insert into public.org_users(org_id, user_id, role, full_name, email) values
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 'admin',   'Parks Flowers',  'parks@foxroofing.co'),
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2', 'manager', 'Tyler Fox',      'tyler@foxroofing.co'),
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'rep',     'Ben Mitchell',   'ben@foxroofing.co'),
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a4', 'rep',     'Colby Remedios', 'Colby@FoxRoofing.co'),
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a5', 'rep',     'Dylan Kreiser',  'dylan@foxroofing.co'),
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a6', 'rep',     'Kayla Smiley',   'kayla@foxroofing.co'),
  ('0f0f0000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'admin',   'Parks Flowers',  'parks@foxroofing.co'),
  ('0f0f0000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b1', 'admin',   'Acme Owner',     'owner@acmeroofing.com'),
  ('0f0f0000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 'rep',     'Acme Rep',       'rep@acmeroofing.com'),
  ('0f0f0000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000c1', 'admin',   'Summit Boss',    'boss@summitexteriors.com');

insert into public.roles(id, org_id, key, name) values
  (pg_temp.u('role-admin'), null, 'admin', 'Admin'), (pg_temp.u('role-manager'), null, 'manager', 'Manager'), (pg_temp.u('role-rep'), null, 'rep', 'Rep');
-- Sam is only in memberships (no org_users row, no email): migrates as a user with no invite.
insert into public.memberships(org_id, user_id, role_id) values
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a7', pg_temp.u('role-manager'));

-- ------------------------------------------------------------------------------------------------ lookups
insert into public.touchpoint_types(id, org_id, key, name, sort_order, is_outreach) values
  (pg_temp.u('tt-call'), null, 'call', 'Call', 1, true), (pg_temp.u('tt-email'), null, 'email', 'Email', 2, true),
  (pg_temp.u('tt-text'), null, 'text', 'Text', 3, true), (pg_temp.u('tt-door_knock'), null, 'door_knock', 'Door Knock', 4, true),
  (pg_temp.u('tt-site_visit'), null, 'site_visit', 'Site Visit', 5, false), (pg_temp.u('tt-inspection'), null, 'inspection', 'Inspection', 6, false),
  (pg_temp.u('tt-meeting'), null, 'meeting', 'Meeting', 7, false), (pg_temp.u('tt-linkedin'), null, 'linkedin', 'LinkedIn', 8, true),
  (pg_temp.u('tt-other'), null, 'other', 'Other', 9, false);

insert into public.touchpoint_outcomes(id, org_id, key, name, sort_order) values
  (pg_temp.u('to-connected'), null, 'connected', 'Connected — had a conversation', 1),
  (pg_temp.u('to-no_answer_voicemail'), null, 'no_answer_voicemail', 'No Answer — left voicemail', 2),
  (pg_temp.u('to-no_answer'), null, 'no_answer', 'No Answer — no voicemail', 3),
  (pg_temp.u('to-gatekeeper'), null, 'gatekeeper', 'Gatekeeper — couldn’t get through', 4),
  (pg_temp.u('to-not_interested'), null, 'not_interested', 'Not Interested', 5),
  (pg_temp.u('to-call_back_later'), null, 'call_back_later', 'Call Back Later', 6),
  (pg_temp.u('to-scheduled'), null, 'scheduled_inspection', 'Scheduled — booked inspection', 7),
  (pg_temp.u('to-bid_submitted'), null, 'bid_submitted', 'Bid Submitted', 8),
  (pg_temp.u('to-won'), null, 'won', 'Won', 9), (pg_temp.u('to-lost'), null, 'lost', 'Lost', 10),
  (pg_temp.u('to-sent'), null, 'sent', 'Sent', 11), (pg_temp.u('to-replied'), null, 'got_a_reply', 'Got a Reply', 12),
  (pg_temp.u('to-bounced'), null, 'bounced', 'Bounced', 13), (pg_temp.u('to-met'), null, 'met_in_person', 'Met in Person', 14),
  (pg_temp.u('to-not_there'), null, 'not_there', 'Not There', 15), (pg_temp.u('to-bid_requested'), null, 'bid_requested', 'Bid Requested', 16),
  (pg_temp.u('to-auto_reply'), null, 'auto_reply', 'Auto-Reply', 17), (pg_temp.u('to-wrong_number'), null, 'wrong_number', 'Wrong Number', 18),
  (pg_temp.u('to-left_message'), null, 'left_message', 'Left Message', 19),
  -- Acme's own outcome: unmapped, but out of scope, so it must not block the FOX migration.
  (pg_temp.u('to-smoke'), '0f0f0000-0000-4000-8000-000000000002', 'smoke_signal', 'Smoke Signal', 20);

insert into public.opportunity_stages(id, org_id, key, name, sort_order, is_closed_stage) values
  (pg_temp.u('st-lead'), null, 'lead', 'Lead', 1, false), (pg_temp.u('st-contacted'), null, 'contacted', 'Contacted', 2, false),
  (pg_temp.u('st-insp_sched'), null, 'inspection_scheduled', 'Inspection Scheduled', 3, false),
  (pg_temp.u('st-insp_done'), null, 'inspection_complete', 'Inspection Complete', 4, false),
  (pg_temp.u('st-proposal'), null, 'proposal_sent', 'Proposal Sent', 5, false), (pg_temp.u('st-negotiation'), null, 'negotiation', 'Negotiation', 6, false),
  (pg_temp.u('st-won'), null, 'won', 'Won', 7, true), (pg_temp.u('st-lost'), null, 'lost', 'Lost', 8, true),
  (pg_temp.u('st-a1'), '0f0f0000-0000-4000-8000-000000000002', 'qualified', 'Qualified', 1, false),
  (pg_temp.u('st-a2'), '0f0f0000-0000-4000-8000-000000000002', 'estimating', 'Estimating', 2, false),
  (pg_temp.u('st-a3'), '0f0f0000-0000-4000-8000-000000000002', 'submitted', 'Submitted', 3, false),
  (pg_temp.u('st-a4'), '0f0f0000-0000-4000-8000-000000000002', 'closed_won', 'Closed Won', 4, true),
  (pg_temp.u('st-a5'), '0f0f0000-0000-4000-8000-000000000002', 'closed_lost', 'Closed Lost', 5, true);

insert into public.scope_types(id, org_id, key, name, sort_order)
select pg_temp.u('sc-' || k), null, k, n, o from (values
  ('repair', 'Repair', 1), ('re_roof', 'Re-Roof', 2), ('re_cover', 'Re-Cover', 3), ('maintenance', 'Maintenance', 4),
  ('inspection', 'Inspection', 5), ('coating', 'Coating', 6), ('emergency', 'Emergency', 7),
  ('new_construction', 'New Construction', 8), ('other', 'Other', 9)) v(k, n, o);

insert into public.lost_reason_types(id, org_id, key, name, sort_order) values
  (pg_temp.u('lr-price'), null, 'price', 'Price', 1), (pg_temp.u('lr-timing'), null, 'timing', 'Timing', 2),
  (pg_temp.u('lr-competitor'), null, 'competitor', 'Went with competitor', 3), (pg_temp.u('lr-none'), null, 'no_response', 'No response', 4);
insert into public.milestone_types(id, org_id, key, name, sort_order) values
  (pg_temp.u('ms-insp'), null, 'inspection', 'Inspection', 1), (pg_temp.u('ms-bid'), null, 'bid', 'Bid', 2), (pg_temp.u('ms-won'), null, 'won', 'Won', 3);
insert into public.score_rules(org_id, touchpoint_type_id, points) select null, id, 1 from public.touchpoint_types;

-- ------------------------------------------------------------------------------------------------ FOX accounts (40 live + 2 soft-deleted)
insert into public.accounts(id, org_id, name, account_type, status, notes, created_at, updated_at, created_by, deleted_at, website, phone, source, city, state, onboarding_status)
select pg_temp.u('acct' || n), '0f0f0000-0000-4000-8000-000000000001',
       case n when 2 then 'CBRE — Austin (address TBD)' when 4 then 'Greystar' when 5 then 'Greystar, Inc.' else 'Account ' || n end,
       (array['Property Mgmt', 'property_mgmt', 'Owner', 'HOA', 'GC', null, 'Asset Management', 'Developer'])[1 + n % 8],
       case when n % 13 = 0 then 'do_not_pursue' when n % 11 = 0 then 'existing_client' else 'active' end,
       case when n % 4 = 0 then 'Account note ' || n || ' ' || repeat('details ', n) end,
       timestamptz '2026-03-01T15:00:00Z' + n * interval '1 day', timestamptz '2026-03-01T15:00:00Z' + n * interval '1 day' + interval '2 hours',
       (array['00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a2']::uuid[])[1 + n % 3],
       case when n > 40 then timestamptz '2026-06-01T12:00:00Z' end,
       'https://account' || n || '.example.com', '512-555-' || lpad(n::text, 4, '0'), 'manual', 'Austin', 'TX',
       (array['initial_touch', 'paperwork_started', 'paperwork_received', 'paperwork_finished', 'compliant'])[1 + n % 5]
  from generate_series(1, 42) n;

-- account_assignments: acct1 -> Ben (owner) + Colby (support)
insert into public.account_assignments(org_id, account_id, user_id, assigned_at) values
  ('0f0f0000-0000-4000-8000-000000000001', pg_temp.u('acct1'), '00000000-0000-4000-8000-0000000000a3', '2026-03-02T15:00:00Z'),
  ('0f0f0000-0000-4000-8000-000000000001', pg_temp.u('acct1'), '00000000-0000-4000-8000-0000000000a4', '2026-03-03T15:00:00Z');

-- ------------------------------------------------------------------------------------------------ FOX contacts (120 live + 2 soft-deleted)
-- contact121 is soft-deleted (touches on it migrate unlinked); contact7 belongs to soft-deleted acct41 (orphan).
insert into public.contacts(id, org_id, account_id, full_name, first_name, last_name, title, email, phone, is_active, created_at, updated_at, created_by, deleted_at, decision_role, priority_score)
select pg_temp.u('contact' || n), '0f0f0000-0000-4000-8000-000000000001',
       case when n = 7 then pg_temp.u('acct41') else pg_temp.u('acct' || (1 + (n - 1) % 40)) end,
       case when n = 9 then 'Test Contact' when n % 3 = 0 then 'Pat Q. Smith' || n else 'Jordan Lee' || n end,
       case when n % 3 = 1 then 'Jordan' end, case when n % 3 = 1 then 'Lee' || n end,
       'Property Manager',
       case when n in (20, 21) then 'shared@example.com' else 'person' || n || '@example.com' end,
       '512-555-' || lpad((1000 + n)::text, 4, '0'),
       n % 17 <> 0,
       timestamptz '2026-04-01T15:00:00Z' + n * interval '3 hours', timestamptz '2026-04-01T15:00:00Z' + n * interval '3 hours',
       '00000000-0000-4000-8000-0000000000a3',
       case when n > 120 then timestamptz '2026-06-02T12:00:00Z' end,
       (array[null, 'decision_maker', 'influencer', 'gatekeeper', 'unknown'])[1 + n % 5],
       n % 7
  from generate_series(1, 122) n;

-- ------------------------------------------------------------------------------------------------ FOX properties (100 live + 1 soft-deleted)
insert into public.properties(id, org_id, address_line1, address_line2, city, state, postal_code, primary_account_id, notes, is_active,
                              created_at, updated_at, created_by, deleted_at, roof_type, roof_age_years, sq_footage, name, building_type)
select pg_temp.u('prop' || n), '0f0f0000-0000-4000-8000-000000000001',
       case when n = 3 then '123 Test 2' when n = 12 then '100 Main Street' when n = 13 then '100 Main St' else n || ' Oak Street' end,
       case when n % 10 = 0 then 'Suite ' || n end,
       'Austin', 'TX', '787' || lpad((n % 100)::text, 2, '0'),
       case when n between 91 and 100 then null else pg_temp.u('acct' || (1 + (n - 1) % 40)) end,
       case when n % 5 = 0 then 'Roof note ' || n end,
       n % 23 <> 0,
       timestamptz '2026-04-10T15:00:00Z' + n * interval '5 hours', timestamptz '2026-04-10T15:00:00Z' + n * interval '5 hours',
       '00000000-0000-4000-8000-0000000000a4',
       case when n = 101 then timestamptz '2026-06-03T12:00:00Z' end,
       (array['TPO', 'EPDM', 'Mod Bit', 'Metal'])[1 + n % 4], 5 + n % 20, 20000 + n * 100,
       'Building ' || n, (array['Multifamily', 'Office', 'Retail', 'Industrial'])[1 + n % 4]
  from generate_series(1, 101) n;

-- property_accounts: owners (prop1-8), current managers = primary (prop9-13), ended manager history (prop14-16),
-- a GC link (prop18-19: not an ownership party), and a second current manager on prop17 (extra_current).
insert into public.property_accounts(org_id, property_id, account_id, relationship_type, is_primary, active, starts_on, ends_on, created_at)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || n), pg_temp.u('acct' || (21 + n)), 'owner', false, true, date '2025-01-01', null::date, timestamptz '2026-04-20T00:00:00Z'
  from generate_series(1, 8) n
union all
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || n), pg_temp.u('acct' || (1 + (n - 1) % 40)), 'property_manager', true, true, date '2025-06-01', null::date, timestamptz '2026-04-20T00:00:00Z'
  from generate_series(9, 13) n
union all
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || n), pg_temp.u('acct' || (10 + n)), 'property_manager', false, false, date '2023-01-01', date '2025-05-31', timestamptz '2026-04-20T00:00:00Z'
  from generate_series(14, 16) n
union all
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || n), pg_temp.u('acct40'), 'gc', false, true, null, null, timestamptz '2026-04-20T00:00:00Z'
  from generate_series(18, 19) n
union all
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop17'), pg_temp.u('acct' || a), 'property_manager', a = 30, true, date '2025-02-01', null, timestamptz '2026-04-20T00:00:00Z'
  from unnest(array[30, 31]) a;

-- property_contacts: 130 rows; pairs n<=5 get a second role (one Dilly link with both roles); 5 inactive.
insert into public.property_contacts(org_id, property_id, contact_id, relationship_type, priority_rank, is_primary, active, created_at, role_category, role_label)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || (1 + (n - 1) % 100)), pg_temp.u('contact' || (1 + (n * 7) % 120)),
       null, 0, n % 10 = 1, n not between 60 and 64, timestamptz '2026-04-25T00:00:00Z',
       (array['property_manager', 'maintenance', 'owner_rep', 'other'])[1 + n % 4], case when n % 9 = 0 then 'Regional PM' end
  from generate_series(1, 125) n
union all
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || n), pg_temp.u('contact' || (1 + (n * 7) % 120)),
       null, 1, false, true, timestamptz '2026-04-25T00:00:00Z', 'leasing', null
  from generate_series(1, 5) n;

-- property_assignments: prop1-15 to reps (Dylan has not signed in to Dilly)
insert into public.property_assignments(org_id, property_id, user_id, created_at)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('prop' || n),
       (array['00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a5']::uuid[])[1 + n % 3],
       timestamptz '2026-04-26T00:00:00Z' + n * interval '1 hour'
  from generate_series(1, 15) n;

-- ------------------------------------------------------------------------------------------------ FOX opportunities (18 live + 1 soft-deleted)
-- opp3/opp4: status lost while the stage still says Proposal Sent; opp5/opp6: won with a final value.
insert into public.opportunities(id, org_id, property_id, scope_type_id, stage_id, status, title, estimated_value, bid_value, final_value,
                                 created_reason, opened_at, closed_at, lost_reason_type_id, lost_notes, created_at, updated_at, created_by,
                                 deleted_at, account_id, primary_contact_id)
select pg_temp.u('opp' || k), '0f0f0000-0000-4000-8000-000000000001', pg_temp.u('prop' || (k * 5)),
       pg_temp.u('sc-' || (array['repair', 're_roof', 're_cover', 'maintenance', 'inspection', 'coating', 'emergency', 'new_construction', 'other'])[1 + k % 9]),
       case when k in (3, 4) then pg_temp.u('st-proposal') when k in (5, 6) then pg_temp.u('st-won')
            else pg_temp.u('st-' || (array['lead', 'contacted', 'insp_sched', 'insp_done', 'proposal', 'negotiation'])[1 + k % 6]) end,
       case when k in (3, 4) then 'lost' when k in (5, 6) then 'won' else 'open' end,
       case when k = 8 then null else 'Opportunity ' || k end,
       10000 + k * 1000, case when k % 2 = 0 then 12000 + k * 1000 end, case when k in (5, 6) then 15000 + k * 1000 end,
       'touch', timestamptz '2026-05-01T15:00:00Z' + k * interval '1 day',
       case when k between 3 and 6 then timestamptz '2026-07-01T15:00:00Z' + k * interval '1 day' end,
       case when k in (3, 4) then pg_temp.u('lr-price') end, case when k = 3 then 'Owner chose the low bid' end,
       timestamptz '2026-05-01T15:00:00Z' + k * interval '1 day', timestamptz '2026-05-02T15:00:00Z' + k * interval '1 day',
       '00000000-0000-4000-8000-0000000000a3', case when k = 19 then timestamptz '2026-06-04T12:00:00Z' end,
       pg_temp.u('acct' || (1 + (k * 5 - 1) % 40)), pg_temp.u('contact' || k)
  from generate_series(1, 19) k;
insert into public.opportunity_assignments(org_id, opportunity_id, user_id, assignment_role, is_primary)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, pg_temp.u('opp' || k),
       (array['00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a6']::uuid[])[1 + k % 3],
       'primary_rep', true
  from generate_series(1, 10) k;

-- ------------------------------------------------------------------------------------------------ FOX touchpoints (300)
-- Reps rotate Tyler/Ben/Colby/Dylan/Kayla. Every 6th is an email; outcome depends on the type; i%37=0 has no outcome.
-- i in 41..45 are on soft-deleted contact121. Times every 4h07m from Aug 1. i%25=0 was logged 2 days late.
insert into public.touchpoints(id, org_id, rep_user_id, property_id, account_id, contact_id, opportunity_id, touchpoint_type_id, outcome_id,
                               happened_at, notes, created_at, updated_at, created_by, engagement_phase, direction)
select pg_temp.u('tp' || i), '0f0f0000-0000-4000-8000-000000000001', rep, prop,
       case when i % 2 = 0 then acct end, con, case when i % 30 = 0 then pg_temp.u('opp' || (1 + i % 18)) end,
       pg_temp.u('tt-' || typ), case when i % 37 = 0 then null else pg_temp.u('to-' || outc) end,
       ts,
       case when i % 50 = 7 then 'test note please ignore' when i % 4 = 0 then 'Touch ' || i || ': ' || repeat('PM in a meeting, call back. ', 1 + i % 6) end,
       case when i % 25 = 0 then ts + interval '2 days' else ts end, ts, rep,
       (array['first_touch', 'follow_up', 'visibility'])[1 + i % 3],
       case when outc in ('replied', 'auto_reply') then 'inbound' else 'outbound' end
  from (
    select i,
           (array['00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a4',
                  '00000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-0000000000a6']::uuid[])[1 + i % 5] as rep,
           case when i % 3 = 0 then pg_temp.u('prop' || (1 + i % 100)) end as prop,
           case when i between 41 and 45 then pg_temp.u('contact121') else pg_temp.u('contact' || (1 + (i * 7) % 120)) end as con,
           case when i between 41 and 45 then pg_temp.u('acct1') else pg_temp.u('acct' || (1 + ((1 + (i * 7) % 120) - 1) % 40)) end as acct,
           case when i % 50 = 0 then 'meeting' else (array['call', 'email', 'text', 'door_knock', 'site_visit', 'inspection'])[1 + i % 6] end as typ,
           case when i % 50 = 0 then 'met'
                when i % 6 = 1 then (array['sent', 'sent', 'replied', 'bounced', 'auto_reply'])[1 + (i / 6) % 5]
                when i % 6 = 3 then (array['met', 'not_there'])[1 + i % 2]
                when i % 6 in (4, 5) then (array['met', 'scheduled', 'bid_requested', 'wrong_number'])[1 + i % 4]
                else (array['connected', 'no_answer_voicemail', 'no_answer', 'gatekeeper', 'not_interested', 'call_back_later', 'scheduled', 'left_message'])[1 + i % 8] end as outc,
           timestamptz '2026-08-01T14:00:00Z' + i * interval '4 hours 7 minutes' as ts
      from generate_series(1, 300) i) s;

-- ------------------------------------------------------------------------------------------------ synced emails
-- Linked to an email touchpoint (Gmail id only, no new touch): every email touchpoint i (i%6=1), message id gm-<i>.
-- tp13 carries the SAME Gmail message as tp7 (synced for a second rep): one Dilly touch keeps the id, one is flagged.
insert into public.synced_emails(org_id, user_id, gmail_message_id, thread_id, direction, from_email, to_emails, subject, message_ts, matched_contact_id, touchpoint_id)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, t.rep_user_id,
       case when i = 13 then 'gm-7' else 'gm-' || i end, 'th-' || i,
       t.direction, 'rep@foxroofing.co', array['person@example.com'], 'Subject ' || i, t.happened_at, t.contact_id, t.id
  from generate_series(1, 300) i join public.touchpoints t on t.id = pg_temp.u('tp' || i)
 where i % 6 = 1;
-- Matched to a contact, never logged as a touchpoint: become Dilly touches (12).
insert into public.synced_emails(org_id, user_id, gmail_message_id, thread_id, direction, from_email, to_emails, subject, message_ts, matched_contact_id, touchpoint_id)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000a3', 'gm-u' || n, 'th-u' || n,
       case when n % 3 = 0 then 'inbound' else 'outbound' end, 'ben@foxroofing.co', array['person@example.com'], 'Unlogged ' || n,
       timestamptz '2026-07-15T15:00:00Z' + n * interval '1 hour', pg_temp.u('contact' || (n * 3)), null
  from generate_series(1, 12) n;
-- Matched, not linked, but an email touchpoint on the same contact within 10 minutes already represents it (4): legacy only.
insert into public.synced_emails(org_id, user_id, gmail_message_id, thread_id, direction, from_email, to_emails, subject, message_ts, matched_contact_id, touchpoint_id)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, t.rep_user_id, 'gm-r' || i, 'th-r' || i, 'outbound', 'rep@foxroofing.co', array['x@example.com'],
       'Represented ' || i, t.happened_at + interval '3 minutes', t.contact_id, null
  from unnest(array[19, 25, 31, 37]) i join public.touchpoints t on t.id = pg_temp.u('tp' || i);
-- No matched contact (6): legacy only.
insert into public.synced_emails(org_id, user_id, gmail_message_id, thread_id, direction, from_email, to_emails, subject, message_ts, matched_contact_id, touchpoint_id)
select '0f0f0000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-0000000000a4', 'gm-n' || n, 'th-n' || n, 'inbound', 'stranger@example.com',
       array['colby@foxroofing.co'], 'Newsletter ' || n, timestamptz '2026-07-20T15:00:00Z' + n * interval '1 hour', null, null
  from generate_series(1, 6) n;

-- ------------------------------------------------------------------------------------------------ FOX next actions (170)
-- j even & <=150: created by touchpoint j+150 at EXACTLY its happened_at (V2 does both in one transaction) on its contact;
--   for j+150 > 180 that contact has no later touch, so the follow-up must stay open (not closed by its own touch).
-- j odd & <=150: created Jul 20+ (before most touches). 151-165 completed (by touchpoint j), 166-170 dismissed.
insert into public.next_actions(id, org_id, property_id, opportunity_id, assigned_user_id, recommended_touchpoint_type_id, due_at, status, notes,
                                created_from_touchpoint_id, completed_by_touchpoint_id, created_at, updated_at, created_by, contact_id, account_id,
                                snoozed_count, dismiss_reason)
select pg_temp.u('na' || j), '0f0f0000-0000-4000-8000-000000000001', null, null,
       coalesce(t.rep_user_id, '00000000-0000-4000-8000-0000000000a5'),
       case when j % 3 = 0 then pg_temp.u('tt-call') end,
       coalesce(t.happened_at, timestamptz '2026-07-20T15:00:00Z' + j * interval '7 hours') + interval '3 days',
       case when j <= 150 then 'open' when j <= 165 then 'completed' else 'dismissed' end,
       case when j % 5 = 0 then 'Follow up — ' || repeat('ask about the leak over unit 4. ', 1 + j % 3) when j = 77 then 'Follow up — test 3 test 3' end,
       t.id,
       case when j between 151 and 165 then pg_temp.u('tp' || j) end,
       coalesce(t.happened_at, timestamptz '2026-07-20T15:00:00Z' + j * interval '7 hours'),
       coalesce(t.happened_at, timestamptz '2026-07-20T15:00:00Z' + j * interval '7 hours') + interval '1 hour',
       '00000000-0000-4000-8000-0000000000a2',
       coalesce(t.contact_id, pg_temp.u('contact' || (1 + (j * 11) % 120))),
       null, j % 4, case when j > 165 then 'not a fit' end
  from generate_series(1, 170) j
  left join public.touchpoints t on j % 2 = 0 and j <= 150 and t.id = pg_temp.u('tp' || (j + 150));

-- V2 points (not migrated as points; totals kept for comparison)
insert into public.score_events(org_id, user_id, touchpoint_id, points, reason, created_at)
select t.org_id, t.rep_user_id, t.id, 2, 'touch', t.happened_at from public.touchpoints t;
insert into public.streaks(org_id, user_id, streak_type, current_count) values
  ('0f0f0000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a3', 'daily', 4);
insert into public.touchpoint_revisions(org_id, touchpoint_id, revised_by, reason, before, after)
values ('0f0f0000-0000-4000-8000-000000000001', pg_temp.u('tp5'), '00000000-0000-4000-8000-0000000000a2', 'typo', '{"notes":"x"}', '{"notes":"y"}');

-- ------------------------------------------------------------------------------------------------ other orgs (never migrated)
insert into public.accounts(id, org_id, name, account_type, status, created_at, updated_at, onboarding_status)
select pg_temp.u('xacct' || n), case when n <= 8 then '0f0f0000-0000-4000-8000-000000000002'::uuid else '0f0f0000-0000-4000-8000-000000000003'::uuid end,
       case when n <= 8 then 'Acme Client ' || n else 'Summit Client ' || n end, 'Weird Type ' || n, 'mystery', now(), now(), 'initial_touch'
  from generate_series(1, 12) n;
insert into public.contacts(id, org_id, account_id, full_name, email, created_at, updated_at, decision_role)
select pg_temp.u('xcontact' || n), a.org_id, a.id, 'Other Person ' || n, 'other' || n || '@example.org', now(), now(), 'Supreme Leader'
  from generate_series(1, 20) n join public.accounts a on a.id = pg_temp.u('xacct' || (1 + n % 12));
insert into public.properties(id, org_id, address_line1, city, state, postal_code, primary_account_id, name, created_at, updated_at)
select pg_temp.u('xprop' || n), a.org_id, n || ' Elsewhere Rd', 'Memphis', 'TN', '38103', a.id, 'Other Building ' || n, now(), now()
  from generate_series(1, 10) n join public.accounts a on a.id = pg_temp.u('xacct' || n);
insert into public.touchpoints(org_id, rep_user_id, account_id, contact_id, touchpoint_type_id, outcome_id, happened_at, engagement_phase, direction, notes)
select c.org_id, case when c.org_id = '0f0f0000-0000-4000-8000-000000000002' then '00000000-0000-4000-8000-0000000000b2'::uuid else '00000000-0000-4000-8000-0000000000c1'::uuid end,
       c.account_id, c.id, pg_temp.u('tt-call'), pg_temp.u('to-smoke'), timestamptz '2026-08-10T15:00:00Z' + n * interval '1 hour', 'first_touch', 'outbound', 'Other org touch'
  from generate_series(1, 30) n join public.contacts c on c.id = pg_temp.u('xcontact' || (1 + n % 20));
insert into public.opportunities(org_id, property_id, scope_type_id, stage_id, status, title, estimated_value)
select p.org_id, p.id, pg_temp.u('sc-repair'), pg_temp.u('st-a2'), 'estimating', 'Other deal ' || n, 99999
  from generate_series(1, 5) n join public.properties p on p.id = pg_temp.u('xprop' || n);
insert into public.next_actions(org_id, assigned_user_id, due_at, contact_id, status)
select c.org_id, '00000000-0000-4000-8000-0000000000b2', now(), c.id, 'whenever'
  from generate_series(1, 10) n join public.contacts c on c.id = pg_temp.u('xcontact' || n);
insert into public.synced_emails(org_id, user_id, gmail_message_id, direction, message_ts, matched_contact_id)
select '0f0f0000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 'acme-' || n, 'outbound', now(), pg_temp.u('xcontact1')
  from generate_series(1, 3) n;
insert into public.score_events(org_id, user_id, points, reason) values ('0f0f0000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 50, 'acme');
insert into public.intel_entities(cik, name) values ('0000001', 'Shared REIT');
insert into public.demo_requests(name, email) values ('Someone', 'someone@example.com');

-- Supabase grants (V2-freeze.sql revokes the write ones)
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
