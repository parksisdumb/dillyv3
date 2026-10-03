-- Dilly — reference data required in every environment. Idempotent.

-- Labels for the UI (integrity is enforced by the app.* domains).
insert into public.vocab(domain, code, label, sort) values
 ('channel','call','Call',10),('channel','email','Email',20),('channel','text','Text',30),
 ('channel','door_knock','Door knock',40),('channel','site_visit','Site visit',50),('channel','inspection','Inspection',60),
 ('channel','roof_walk','Roof walk',70),('channel','lunch_and_learn','Lunch & learn',80),('channel','event','Event',90),
 ('channel','meeting','Meeting',95),('channel','linkedin','LinkedIn',100),('channel','mail','Mail',110),('channel','other','Other',200),
 ('outcome','connected','Connected',10),('outcome','met_in_person','Met in person',15),('outcome','met_decision_maker','Met decision maker',16),
 ('outcome','voicemail','Left voicemail',20),('outcome','no_answer','No answer',30),('outcome','gatekeeper','Gatekeeper',40),
 ('outcome','not_there','Not there',45),('outcome','call_back_later','Call back later',50),('outcome','scheduled_inspection','Booked inspection',60),
 ('outcome','bid_requested','Bid requested',70),('outcome','bid_submitted','Bid submitted',80),('outcome','sent','Sent',90),
 ('outcome','replied','Got a reply',95),('outcome','not_interested','Not interested',100),('outcome','bounced','Bounced',110),
 ('outcome','auto_reply','Auto-reply',115),('outcome','won','Won',120),('outcome','lost','Lost',130),('outcome','other','Other',200),
 ('account_type','property_mgmt','Property mgmt',10),('account_type','owner','Owner',20),('account_type','reit','REIT',25),
 ('account_type','institutional','Institutional',27),('account_type','facilities','Facilities',30),('account_type','asset_mgmt','Asset mgmt',40),
 ('account_type','gc','General contractor',50),('account_type','developer','Developer',60),('account_type','consultant','Roof consultant',70),
 ('account_type','architect','Architect',75),('account_type','broker','Broker',80),('account_type','government','Government',90),
 ('account_type','education','Education',91),('account_type','healthcare','Healthcare',92),('account_type','industrial','Industrial',93),
 ('account_type','retail','Retail',94),('account_type','hospitality','Hospitality',95),('account_type','religious','House of worship',96),
 ('account_type','vendor','Vendor',150),('account_type','other','Other',200),
 ('stage','lead','Lead',10),('stage','contacted','Contacted',20),('stage','inspection_scheduled','Inspection scheduled',30),
 ('stage','inspection_complete','Inspection complete',40),('stage','proposal_sent','Proposal sent',50),('stage','negotiation','Negotiation',60),
 ('stage','won','Won',70),('stage','lost','Lost',80),
 ('service_line','inspection','Inspection',10),('service_line','repair','Repair',20),('service_line','maintenance','Maintenance program',30),
 ('service_line','emergency','Emergency / leak',35),('service_line','re_roof','Re-roof',40),('service_line','re_cover','Re-cover',50),
 ('service_line','coating','Coating',60),('service_line','new_construction','New construction',70),
 ('service_line','tenant_improvement','Tenant improvement',80),('service_line','envelope','Envelope',90),
 ('service_line','insurance_claim','Insurance claim',95),('service_line','other','Other',200),
 ('persona_role','economic_buyer','Decision maker',10),('persona_role','evaluator','Evaluator',20),('persona_role','initiator','Initiator',30),
 ('persona_role','influencer','Influencer',40),('persona_role','gatekeeper','Gatekeeper',50),('persona_role','user','On-site user',60),
 ('persona_role','unknown','Unknown',100),
 ('onboarding_status','none','Not started',0),('onboarding_status','initial_touch','Initial touch',10),
 ('onboarding_status','paperwork_started','Paperwork started',20),('onboarding_status','paperwork_received','Paperwork received',30),
 ('onboarding_status','paperwork_finished','Paperwork finished',40),('onboarding_status','compliant','Compliant / active vendor',50),
 ('preference','pursue','Pursue',10),('preference','deprioritize','Deprioritize',20),('preference','do_not_pursue','Do not pursue',30),
 ('preference','competitor','Competitor',40),('preference','existing_client','Existing client',50),('preference','partner','Partner',60)
on conflict (domain, code) do update set label = excluded.label, sort = excluded.sort;

-- Outcome → next task (platform defaults; tenants can override per outcome).
insert into public.outcome_rule(tenant_id, outcome, next_kind, business_days, title_template, priority, contact_level) values
 (null,'connected','follow_up',5,'Follow up with {contact}',55,true),
 (null,'met_in_person','follow_up',3,'Follow up with {contact} after visit',60,true),
 (null,'met_decision_maker','follow_up',3,'Next step with {contact}',70,true),
 (null,'voicemail','follow_up',3,'Call {contact} back',45,true),
 (null,'no_answer','follow_up',2,'Try {contact} again',40,true),
 (null,'gatekeeper','try_other_contact',2,'Find another way into {account}',45,false),
 (null,'not_there','revisit',2,'Revisit {account}',45,false),
 (null,'call_back_later','follow_up',7,'Call {contact} back (they asked)',55,true),
 (null,'scheduled_inspection','inspection',2,'Confirm inspection with {contact}',80,true),
 (null,'bid_requested','proposal',1,'Prepare bid for {account}',90,true),
 (null,'bid_submitted','follow_up',5,'Follow up on bid with {contact}',75,true),
 (null,'sent','follow_up',3,'Follow up on email to {contact}',40,true),
 (null,'replied','follow_up',1,'Respond to {contact}',85,true),
 (null,'not_interested','follow_up',65,'Check back with {contact}',20,true),
 (null,'lost','follow_up',130,'Check back with {account}',20,false),
 (null,'won',null,null,null,0,true),
 (null,'bounced',null,null,null,0,true),
 (null,'auto_reply',null,null,null,0,true),
 (null,'other',null,null,null,0,true)
on conflict (tenant_id, outcome) do update set next_kind = excluded.next_kind, business_days = excluded.business_days,
  title_template = excluded.title_template, priority = excluded.priority, contact_level = excluded.contact_level;

-- Gamification v2 point table (see 08-DILLY-V2-AUDIT-AND-CARRYOVER §4).
insert into public.point_rule(tenant_id, event, points, label) values
 (null,'touch_logged',1,'Logged touch'),
 (null,'connect',3,'Conversation'),
 (null,'decision_maker_conversation',6,'Reached a decision maker'),
 (null,'field_contact_created',4,'New contact from the field'),
 (null,'follow_up_on_time',3,'Follow-up on time'),
 (null,'clean_week',5,'Clean week (all follow-ups on time)'),
 (null,'inspection_booked',10,'Inspection / site walk booked'),
 (null,'site_walk_completed',12,'Site walk completed with photos'),
 (null,'bid_requested',15,'Bid requested'),
 (null,'proposal_delivered',20,'Proposal delivered'),
 (null,'onboarding_step',15,'Vendor paperwork step'),
 (null,'lunch_and_learn',25,'Lunch & learn hosted'),
 (null,'won',50,'Won'),
 (null,'cold_rescued',5,'Cold P1/P2 account re-engaged')
on conflict (tenant_id, event) do update set points = excluded.points, label = excluded.label;

-- Agent registry (Phase 0 agents enabled; the rest registered disabled so runs and approvals can reference them).
insert into public.agent(key, name, pod, description, default_tier, enabled) values
 ('orchestrator','Orchestrator',0,'Dispatches work items, enforces gates, schedules follow-on work','sonnet',true),
 ('evaluator','Evaluator / QA',0,'Grades agent output before a human sees it; computes trust scores','opus',true),
 ('sending-governor','Sending Governor',0,'Single ledger and caps for every outbound message','haiku',false),
 ('rep-daily-brief','Rep Daily Brief & Reminders',3,'Three-line morning brief, ranked queue, reminder ladder','opus',true),
 ('crm-audit','CRM Audit & Insights',3,'Weekly audit of data and funnel; one brief that changes a decision','opus',false),
 ('field-events','Field & Events',3,'Field plan, visit briefs, card/voice/photo capture, lunch-and-learns','opus',false),
 ('cold-outreach','Cold Outreach',3,'Persona × signal × service-line first touches','opus',false),
 ('follow-up-sequencer','Follow-Up Sequencer',3,'Executes cadences; hands warm replies to Speed-to-Lead','haiku',false),
 ('inbound-reader','Inbound Reader / Triage',3,'Classifies and routes every inbound message','sonnet',false),
 ('list-build','List-Build & Enrichment',1,'Ranked accounts and verified contacts per market','sonnet',false),
 ('signal','Signal / Trigger',1,'Storm, permit, sale, bid and ownership signals','haiku',false),
 ('roofmachine-ingest','roofmachine Ingest',1,'REIT property data into accounts/properties','haiku',false),
 ('federal-bids-ingest','Federal Bids Ingest',1,'Federal Bids agent output into bid requests','haiku',false),
 ('procurement-onboarding','Procurement / Onboarding',5,'Vendor paperwork and prequal packets','opus',false)
on conflict (key) do update set name = excluded.name, description = excluded.description, default_tier = excluded.default_tier;

-- Markets for current tenants (TSG: Memphis launch + TN/AR/MS; FOX: Austin, DFW).
insert into public.market(slug, name, state, timezone, center_lat, center_lng) values
 ('memphis','Memphis','TN','America/Chicago',35.149500,-90.049000),
 ('nashville','Nashville','TN','America/Chicago',36.162700,-86.781600),
 ('jackson-tn','Jackson','TN','America/Chicago',35.614500,-88.813900),
 ('little-rock','Little Rock','AR','America/Chicago',34.746500,-92.289600),
 ('north-mississippi','North Mississippi (DeSoto / Tupelo / Oxford)','MS','America/Chicago',34.500000,-89.300000),
 ('austin','Austin','TX','America/Chicago',30.267200,-97.743100),
 ('dfw','Dallas–Fort Worth','TX','America/Chicago',32.776700,-96.797000),
 ('san-antonio','San Antonio','TX','America/Chicago',29.424100,-98.493600),
 ('houston','Houston','TX','America/Chicago',29.760400,-95.369800)
on conflict (slug) do update set name = excluded.name;

insert into public.platform_admin_email(email) values ('team@dillyos.com') on conflict do nothing;
