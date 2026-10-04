-- Dilly — RLS follow-ups for the ownership feature + the profile update policy.
--
-- 1) property_party, contact_employment (20261004001000) and property_flag (20261004001100) were created with the
--    per-row app.is_member(tenant_id) pattern. Switch select/insert/update to the InitPlan form introduced in
--    20261004000500_performance.sql: `tenant_id = any ((select app.my_tenant_ids())::uuid[])` evaluates the
--    membership lookup once per statement instead of once per row. Semantics are identical (platform admins see
--    every tenant; others their active memberships). Delete policies keep app.has_role (low volume), exactly as
--    the performance migration did for the core tables. property_flag still has no delete policy (flags are history).
--
-- 2) profile_update's WITH CHECK read public.profile from inside a profile policy, which Postgres rejects at
--    run time ("infinite recursion detected in policy for relation profile", 42P17) — Settings → Save profile
--    failed for everyone. app.is_platform_admin() is SECURITY DEFINER, so it reads the stored flag without
--    re-entering RLS. Same rule: you may update your own row but not change is_platform_admin.

do $$
declare t text;
begin
  for t in select unnest(array['property_party', 'contact_employment', 'property_flag'])
  loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format($f$create policy %1$s_select on public.%1$I for select to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
    execute format($f$create policy %1$s_insert on public.%1$I for insert to authenticated
                      with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
    execute format($f$create policy %1$s_update on public.%1$I for update to authenticated
                      using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))
                      with check (tenant_id = any ((select app.my_tenant_ids())::uuid[]))$f$, t);
  end loop;
end $$;

drop policy if exists profile_update on public.profile;
create policy profile_update on public.profile for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and is_platform_admin = app.is_platform_admin());
