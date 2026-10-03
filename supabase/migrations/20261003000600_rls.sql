-- Dilly — row-level security. A user sees and writes only rows of tenants they belong to.
-- Platform admins (Parks) see every tenant. Service role (agents, cron) bypasses RLS.

grant usage on schema public, app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to authenticated, service_role;
revoke all on public.platform_admin_email from authenticated;

do $$
declare t text;
begin
  for t in select unnest(array[
    'tenant','profile','membership','invite','market','tenant_market','segment','vocab',
    'account','account_assignment','contact','property','property_contact','opportunity',
    'tenant_targeting','account_preference','signal','touch','task','outcome_rule','point_rule','point_event',
    'agent','work_item','agent_run','agent_step','approval','trust_score','brief','insight','rep_day','platform_admin_email'])
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Standard tenant tables: members read/write, admins delete.
do $$
declare t text;
begin
  for t in select unnest(array[
    'account','account_assignment','contact','property','property_contact','opportunity',
    'account_preference','task','segment','tenant_market'])
  loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated using (app.is_member(tenant_id))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated with check (app.is_member(tenant_id))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated using (app.is_member(tenant_id)) with check (app.is_member(tenant_id))$f$, t);
    execute format($f$create policy %1$s_delete on public.%1$I for delete to authenticated using (app.has_role(tenant_id, array['owner','admin']))$f$, t);
  end loop;
end $$;

-- Read-only to members (written by definer functions / service role).
do $$
declare t text;
begin
  for t in select unnest(array['point_event','work_item','agent_run','trust_score','brief','insight','rep_day'])
  loop
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated using (app.is_member(tenant_id))$f$, t);
  end loop;
end $$;
create policy brief_seen on public.brief for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agent_step_select on public.agent_step for select to authenticated
  using (exists (select 1 from public.agent_run r where r.id = run_id and app.is_member(r.tenant_id)));

-- Tenant + people
create policy tenant_select on public.tenant for select to authenticated using (app.is_member(id));
create policy tenant_update on public.tenant for update to authenticated using (app.has_role(id, array['owner','admin']));
create policy profile_select on public.profile for select to authenticated using (
  id = auth.uid() or app.is_platform_admin() or exists (
    select 1 from public.membership a join public.membership b on a.tenant_id = b.tenant_id
     where a.user_id = auth.uid() and b.user_id = profile.id));
create policy profile_update on public.profile for update to authenticated using (id = auth.uid())
  with check (id = auth.uid() and is_platform_admin = (select p.is_platform_admin from public.profile p where p.id = auth.uid()));
create policy membership_select on public.membership for select to authenticated using (app.is_member(tenant_id));
create policy membership_write on public.membership for all to authenticated
  using (app.has_role(tenant_id, array['owner','admin'])) with check (app.has_role(tenant_id, array['owner','admin']));
create policy invite_all on public.invite for all to authenticated
  using (app.has_role(tenant_id, array['owner','admin','manager'])) with check (app.has_role(tenant_id, array['owner','admin','manager']));

-- Targeting is set by humans with authority; agents only propose.
create policy targeting_select on public.tenant_targeting for select to authenticated using (app.is_member(tenant_id));
create policy targeting_write on public.tenant_targeting for all to authenticated
  using (app.has_role(tenant_id, array['owner','admin','manager'])) with check (app.has_role(tenant_id, array['owner','admin','manager']));

-- Shared reference data
create policy market_select on public.market for select to authenticated using (true);
create policy vocab_select on public.vocab for select to authenticated using (true);
create policy agent_select on public.agent for select to authenticated using (true);
create policy signal_select on public.signal for select to authenticated using (tenant_id is null or app.is_member(tenant_id));
create policy signal_insert on public.signal for insert to authenticated with check (tenant_id is not null and app.is_member(tenant_id));
create policy outcome_rule_select on public.outcome_rule for select to authenticated using (tenant_id is null or app.is_member(tenant_id));
create policy outcome_rule_write on public.outcome_rule for all to authenticated
  using (tenant_id is not null and app.has_role(tenant_id, array['owner','admin'])) with check (tenant_id is not null and app.has_role(tenant_id, array['owner','admin']));
create policy point_rule_select on public.point_rule for select to authenticated using (tenant_id is null or app.is_member(tenant_id));
create policy point_rule_write on public.point_rule for all to authenticated
  using (tenant_id is not null and app.has_role(tenant_id, array['owner','admin'])) with check (tenant_id is not null and app.has_role(tenant_id, array['owner','admin']));

-- Touch ledger: members log as themselves (managers may log for others); only managers void.
create policy touch_select on public.touch for select to authenticated using (app.is_member(tenant_id));
create policy touch_insert on public.touch for insert to authenticated with check (
  app.is_member(tenant_id) and (user_id = auth.uid() or app.has_role(tenant_id, array['owner','admin','manager'])));
create policy touch_void on public.touch for update to authenticated using (
  app.has_role(tenant_id, array['owner','admin','manager']) or user_id = auth.uid());

-- Approvals: anyone in the tenant can see; reviewers decide.
create policy approval_select on public.approval for select to authenticated using (app.is_member(tenant_id));
-- G4 legal, G6 spend, G9 customer financial documents stay with owners/admins; reps can clear the rest.
create policy approval_decide on public.approval for update to authenticated using (
  app.has_role(tenant_id, array['owner','admin'])
  or (gate not in ('G4','G6','G9') and app.has_role(tenant_id, array['manager','rep','reviewer'])));
