-- Dilly — Web Push subscriptions + digits-only phone search. Additive only (launch week, RUNBOOK §5).
--
-- 1) public.push_subscription: one row per browser push endpoint (a phone with Dilly installed, a desktop
--    browser). Reps manage their own rows; the reminders cron reads them with the service role.
--    An endpoint belongs to whoever subscribed last on that browser: public.save_push_subscription claims it
--    (a shared phone that changes hands must not keep pushing the previous rep's reminders).
-- 2) contact.phone_digits: digits of phone + mobile, so "(512) 555-0134", "512.555.0134" and "5125550134"
--    all find the same contact. Trigram index for the `%digits%` match.

-- 1) push_subscription -------------------------------------------------------------------------------------
create table if not exists public.push_subscription (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  user_id          uuid not null references public.profile(id) on delete cascade,
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  user_agent       text,
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failure_count    integer not null default 0,
  disabled_at      timestamptz,
  constraint push_subscription_endpoint_https check (endpoint like 'https://%')
);

create index if not exists push_subscription_user_active_idx
  on public.push_subscription (tenant_id, user_id) where disabled_at is null;

alter table public.push_subscription enable row level security;

drop policy if exists push_subscription_select on public.push_subscription;
drop policy if exists push_subscription_insert on public.push_subscription;
drop policy if exists push_subscription_update on public.push_subscription;
drop policy if exists push_subscription_delete on public.push_subscription;
create policy push_subscription_select on public.push_subscription for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_subscription_insert on public.push_subscription for insert to authenticated
  with check (user_id = (select auth.uid()) and tenant_id = any ((select app.my_tenant_ids())::uuid[]));
create policy push_subscription_update on public.push_subscription for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and tenant_id = any ((select app.my_tenant_ids())::uuid[]));
create policy push_subscription_delete on public.push_subscription for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.push_subscription to authenticated;
grant all on public.push_subscription to service_role;

-- Subscribe (or re-subscribe) this browser for the signed-in user in p_tenant. Upserts on endpoint, so a
-- browser that another user subscribed earlier is handed over (RLS alone can't see that row). Re-enables a
-- disabled row and resets its failure count. Returns the row id.
create or replace function public.save_push_subscription(
  p_tenant uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns uuid language plpgsql security definer set search_path = public, app as $$
declare
  me uuid := auth.uid();
  rid uuid;
begin
  if me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if not (p_tenant = any (app.my_tenant_ids())) then
    raise exception 'not a member of this tenant' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or length(p_endpoint) > 2000
     or coalesce(length(p_p256dh), 0) not between 1 and 200 or coalesce(length(p_auth), 0) not between 1 and 100 then
    raise exception 'invalid push subscription' using errcode = '22023';
  end if;
  insert into public.push_subscription as s (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
  values (p_tenant, me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set tenant_id = excluded.tenant_id,
         user_id = excluded.user_id,
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         user_agent = coalesce(excluded.user_agent, s.user_agent),
         failure_count = 0,
         disabled_at = null,
         -- A different person on this browser starts fresh.
         created_at = case when s.user_id = excluded.user_id then s.created_at else now() end,
         last_success_at = case when s.user_id = excluded.user_id then s.last_success_at else null end
  returning id into rid;
  return rid;
end $$;
revoke all on function public.save_push_subscription(uuid, text, text, text, text) from public;
grant execute on function public.save_push_subscription(uuid, text, text, text, text) to authenticated, service_role;

-- 2) Digits-only phone search ------------------------------------------------------------------------------
-- phone and mobile digits separated by a space, so a search never matches across the two numbers.
alter table public.contact
  add column if not exists phone_digits text
  generated always as (
    nullif(btrim(regexp_replace(coalesce(phone, ''), '\D', '', 'g') || ' ' || regexp_replace(coalesce(mobile, ''), '\D', '', 'g')), '')
  ) stored;

create index if not exists contact_phone_digits_trgm on public.contact using gin (phone_digits gin_trgm_ops);
