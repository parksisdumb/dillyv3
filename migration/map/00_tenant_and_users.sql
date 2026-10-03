-- 00_tenant_and_users.sql — V2 users -> migration.user_map -> NEW profile (by email) + membership, or invite.
-- Reps keep their V2 email; whoever has not signed in to the new app yet gets a public.invite row for the tenant
-- (claim_invites() turns it into a membership on first sign-in). Idempotent.

insert into migration.user_map as m (tenant_id, legacy_table, legacy_user_id, email, full_name, legacy_role, new_role, updated_at)
select migration.tenant_id(), u.legacy_table, u.legacy_id, u.email, u.full_name, u.role, migration.map('user_role', u.role), now()
  from legacy_v.users u
 where migration.in_scope(u.org_id)
on conflict (tenant_id, legacy_user_id) do update
   set email = excluded.email, full_name = excluded.full_name, legacy_role = excluded.legacy_role,
       new_role = excluded.new_role, legacy_table = excluded.legacy_table, updated_at = now();

-- Match NEW profiles by email (citext = case-insensitive).
update migration.user_map m
   set profile_id = p.id, updated_at = now()
  from public.profile p
 where m.tenant_id = migration.tenant_id() and m.email is not null
   and p.email = m.email::citext and m.profile_id is distinct from p.id;

-- Signed-in people: make sure they are members of the tenant (never downgrade an existing membership).
insert into public.membership(tenant_id, user_id, role)
select m.tenant_id, m.profile_id, m.new_role
  from migration.user_map m
 where m.tenant_id = migration.tenant_id() and m.profile_id is not null
on conflict (tenant_id, user_id) do nothing;

-- Not signed in yet: invite (an existing invite for the email — e.g. the seeded FOX roster — is kept as is).
insert into public.invite(tenant_id, email, role, full_name)
select m.tenant_id, m.email::citext, m.new_role, m.full_name
  from migration.user_map m
 where m.tenant_id = migration.tenant_id() and m.profile_id is null and m.email is not null
on conflict (tenant_id, email) do nothing;

update migration.user_map m
   set invite_id = i.id
  from public.invite i
 where m.tenant_id = migration.tenant_id() and i.tenant_id = m.tenant_id and i.email = m.email::citext
   and m.invite_id is distinct from i.id;

-- Legacy leaderboard totals are not migrated as points; kept for comparison with the recomputed v2 scoring.
insert into migration.legacy_value(tenant_id, target_table, target_id, legacy_table, legacy_id, field, value)
select migration.tenant_id(), 'profile', m.profile_id, u.legacy_table, u.legacy_id, 'legacy_points', u.legacy_points
  from legacy_v.users u join migration.user_map m on m.tenant_id = migration.tenant_id() and m.legacy_user_id = u.legacy_id
 where migration.in_scope(u.org_id) and u.legacy_points is not null
on conflict (tenant_id, legacy_table, legacy_id, field) do update set value = excluded.value, target_id = excluded.target_id;

-- Actors seen earlier who have signed in since: mark resolved (95_reattribute.sql applies it to touches).
update migration.unmapped_actor a
   set resolved_profile_id = m.profile_id
  from migration.user_map m
 where a.tenant_id = m.tenant_id and a.legacy_user_id = m.legacy_user_id
   and m.profile_id is not null and a.resolved_profile_id is distinct from m.profile_id;
