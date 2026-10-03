-- Dilly — current tenants (Oct 2026): TSG (The Service Group, Parks's own repair/service company, Memphis launch)
-- and FOX Roofing (Austin / Dallas). Idempotent; safe to re-run. Targeting rows are defaults the tenant can change.

insert into public.tenant(slug, name, brand_name, kind, timezone, service_note, settings) values
 ('tsg', 'The Service Group', 'The Service Group', 'own', 'America/Chicago',
  'Commercial + residential roofing repair/service. Sub-based, executive-run. Cost-plus pricing, 30% margin. Memphis launch; Nashville, north MS, Arkansas next.',
  '{"weekend_reminders": false, "quiet_hours": ["19:00","07:00"], "max_pushes_per_day": 3}'::jsonb),
 ('fox', 'FOX Roofing', 'FOX Roofing', 'client', 'America/Chicago',
  'Commercial roofing, multifamily PMC-heavy book across Austin and Dallas–Fort Worth. Migrating from Dilly V2.',
  '{"weekend_reminders": false, "quiet_hours": ["19:00","07:00"], "max_pushes_per_day": 3}'::jsonb)
on conflict (slug) do update set service_note = excluded.service_note;

insert into public.tenant_market(tenant_id, market_id, role)
select t.id, m.id, x.role from (values
  ('tsg','memphis','primary'), ('tsg','nashville','secondary'), ('tsg','north-mississippi','secondary'),
  ('tsg','little-rock','secondary'), ('tsg','jackson-tn','travel'),
  ('fox','austin','primary'), ('fox','dfw','primary'), ('fox','san-antonio','secondary')
) x(tslug, mslug, role)
join public.tenant t on t.slug = x.tslug join public.market m on m.slug = x.mslug
on conflict (tenant_id, market_id) do update set role = excluded.role;

-- Targeting defaults.
-- TSG is a repair/service company: repair, emergency, maintenance and inspections lead; replacement is welcome
-- but secondary; new construction and tenant improvement are off.
insert into public.tenant_targeting(tenant_id, dimension, value, mode, weight, note)
select t.id, x.dimension, x.value, x.mode, x.weight, x.note from (values
  ('tsg','service_line','repair','include',1.30,'Core offer'),
  ('tsg','service_line','emergency','include',1.30,'Leak calls'),
  ('tsg','service_line','maintenance','include',1.20,'Recurring revenue'),
  ('tsg','service_line','inspection','include',1.10,'Door opener'),
  ('tsg','service_line','re_roof','include',0.80,'Comes through repairs; not chased'),
  ('tsg','service_line','new_construction','exclude',0,'Not a TSG line'),
  ('tsg','service_line','tenant_improvement','exclude',0,'Not a TSG line'),
  ('tsg','account_type','property_mgmt','include',1.20,'Commercial/multifamily first'),
  ('tsg','account_type','owner','include',1.10,null),
  ('tsg','account_type','facilities','include',1.10,null),
  ('tsg','account_type','gc','include',0.40,'GCs rarely buy repairs'),
  ('fox','account_type','property_mgmt','include',1.20,'Book is PMC-heavy'),
  ('fox','account_type','gc','include',0.90,'Separate GC line (new construction / TI)'),
  ('fox','service_line','repair','include',1.10,'Repair-led first touch'),
  ('fox','service_line','re_roof','include',1.10,null)
) x(tslug, dimension, value, mode, weight, note)
join public.tenant t on t.slug = x.tslug
on conflict (tenant_id, dimension, value) do nothing;

insert into public.segment(tenant_id, market_id, name, asset_class, buyer_type, service_line, playbook)
select t.id, m.id, x.name, x.asset_class, x.buyer_type, x.service_line, x.playbook from (values
  ('tsg','memphis','Memphis · PMC & owners · repair','multifamily','property_mgmt','repair','owner_repair'),
  ('tsg','memphis','Memphis · commercial owners & facilities · repair','commercial','owner','repair','owner_repair'),
  ('tsg','memphis','Memphis · storm response','all','all','emergency','storm'),
  ('fox','austin','Austin · PMC · repair-led','multifamily','property_mgmt','repair','owner_repair'),
  ('fox','dfw','DFW · PMC · repair-led','multifamily','property_mgmt','repair','owner_repair'),
  ('fox','austin','Austin · GC bid list','commercial','gc','new_construction','gc_bid_list'),
  ('fox','dfw','DFW · GC bid list','commercial','gc','new_construction','gc_bid_list')
) x(tslug, mslug, name, asset_class, buyer_type, service_line, playbook)
join public.tenant t on t.slug = x.tslug join public.market m on m.slug = x.mslug
on conflict (tenant_id, name) do nothing;

-- People. Invites become memberships on first sign-in (public.claim_invites()).
-- FOX roster mirrors the Dilly V2 FOX tenant as reviewed Sep 13, 2026.
insert into public.invite(tenant_id, email, role, full_name)
select t.id, x.email, x.role, x.full_name from (values
  ('tsg','team@dillyos.com','owner','Parks Flowers'),
  ('fox','parks@foxroofing.co','admin','Parks Flowers'),
  ('fox','tyler@foxroofing.co','manager','Tyler Fox'),
  ('fox','ben@foxroofing.co','rep','Ben Mitchell'),
  ('fox','colby@foxroofing.co','rep','Colby Remedios'),
  ('fox','dylan@foxroofing.co','rep','Dylan Kreiser'),
  ('fox','kayla@foxroofing.co','rep','Kayla Smiley')
) x(tslug, email, role, full_name)
join public.tenant t on t.slug = x.tslug
on conflict (tenant_id, email) do nothing;

insert into public.platform_admin_email(email) values ('parks@foxroofing.co') on conflict do nothing;
