-- Dilly — Gmail (and later Outlook) auto-logging. Additive only (launch week, RUNBOOK §5).
--
-- Carries over Dilly V2's "Connect your Gmail": emails to and from a rep's contacts log as touches. We read
-- message METADATA only (sender, recipients, subject, date) through the gmail.metadata scope — never bodies.
--
-- 1) public.mail_connection: one per (tenant, user, provider). OAuth tokens are encrypted in the app layer
--    (AES-256-GCM, key MAIL_TOKEN_KEY, format 'v1:<base64>') before they reach the database; a CHECK refuses
--    anything that isn't in that envelope, so a plaintext token can never be stored by mistake.
--    The base table is service-role only for the secret columns: signed-in users get a column-level grant on
--    the non-secret columns (RLS: own rows only) and read them through public.my_mail_connection.
-- 2) public.mail_ingest(): the sync's one write path. Inserts synced touches in time order, idempotently
--    (touch_external_uq), skipping messages Dilly V2 already logged (migrated as source 'dillyv2',
--    external_id 'gmail:<id>'). Service role only.
--
-- Dedupe relies on touch.external_id (unique per tenant/source); no separate "seen" table is needed: messages
-- that match no contact are not stored at all (privacy), and re-reading them is cheap and idempotent.

-- 1) mail_connection ---------------------------------------------------------------------------------------
create table if not exists public.mail_connection (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenant(id) on delete cascade,
  user_id                  uuid not null references public.profile(id) on delete cascade,
  provider                 text not null check (provider in ('google','microsoft')),
  email                    citext not null,
  scopes                   text[] not null default '{}',
  refresh_token_encrypted  text,
  access_token_encrypted   text,
  access_expires_at        timestamptz,
  history_id               text,            -- Gmail historyId cursor (Graph: delta link) once the backfill is done
  sync_state               jsonb,           -- in-progress backfill/history paging (resumes next tick)
  status                   text not null default 'active' check (status in ('active','revoked','error')),
  last_error               text,            -- human message shown to the rep ("Reconnect Gmail — …")
  last_synced_at           timestamptz,
  last_sync_stats          jsonb,           -- counts only (fetched, logged, unknown senders…); never addresses
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint mail_connection_one_per_provider unique (tenant_id, user_id, provider),
  constraint mail_connection_refresh_encrypted check (refresh_token_encrypted is null or refresh_token_encrypted like 'v1:%'),
  constraint mail_connection_access_encrypted check (access_token_encrypted is null or access_token_encrypted like 'v1:%')
);
create index if not exists mail_connection_active_idx on public.mail_connection (tenant_id) where status = 'active';
drop trigger if exists mail_connection_updated on public.mail_connection;
create trigger mail_connection_updated before update on public.mail_connection for each row execute function app.touch_updated_at();

alter table public.mail_connection enable row level security;

-- Secret columns: service role only. Supabase's default privileges grant new tables to anon/authenticated,
-- so take everything back first and hand out only the non-secret columns.
revoke all on public.mail_connection from public, anon, authenticated;
grant select (id, tenant_id, user_id, provider, email, status, last_synced_at, last_error, created_at)
  on public.mail_connection to authenticated;
grant all on public.mail_connection to service_role;

drop policy if exists mail_connection_select_own on public.mail_connection;
create policy mail_connection_select_own on public.mail_connection for select to authenticated
  using (user_id = (select auth.uid()));

-- What the Settings card and Today read. security_invoker: the caller's column grant + RLS apply.
create or replace view public.my_mail_connection with (security_invoker = true) as
  select id, tenant_id, provider, email, status, last_synced_at, last_error
    from public.mail_connection
   where user_id = (select auth.uid());
revoke all on public.my_mail_connection from public, anon;
grant select on public.my_mail_connection to authenticated, service_role;

-- 2) mail_ingest -------------------------------------------------------------------------------------------
-- p_rows: [{ external_id, provider_message_id, contact_id, occurred_at, direction, outcome, notes, skip_follow_up }]
-- Rows are applied oldest first so the touch trigger closes and schedules follow-ups in the order mail happened.
-- A row older than the contact's latest touch never schedules a new task (the rep has moved on since).
create or replace function public.mail_ingest(p_tenant uuid, p_user uuid, p_source text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public, app as $$
declare
  r          jsonb;
  v_contact  uuid;
  v_at       timestamptz;
  v_skip     boolean;
  v_id       uuid;
  v_inserted int := 0;
  v_dupes    int := 0;
  v_v2       int := 0;
  v_invalid  int := 0;
begin
  if p_source not in ('gmail','outlook') then
    raise exception 'mail_ingest: unsupported source %', p_source using errcode = '22023';
  end if;
  if not exists (select 1 from public.membership where tenant_id = p_tenant and user_id = p_user and active) then
    raise exception 'mail_ingest: user is not an active member of the tenant' using errcode = '42501';
  end if;

  for r in
    select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb))
     order by (value->>'occurred_at')::timestamptz, value->>'external_id'
  loop
    v_contact := nullif(r->>'contact_id', '')::uuid;
    v_at := (r->>'occurred_at')::timestamptz;
    if v_contact is null or v_at is null or coalesce(r->>'external_id', '') = ''
       or not exists (select 1 from public.contact where id = v_contact and tenant_id = p_tenant) then
      v_invalid := v_invalid + 1;
      continue;
    end if;

    -- Dilly V2 already logged this message (migrated history keeps 'gmail:<message id>').
    if p_source = 'gmail' and coalesce(r->>'provider_message_id', '') <> '' and exists (
         select 1 from public.touch
          where tenant_id = p_tenant and source = 'dillyv2' and external_id = 'gmail:' || (r->>'provider_message_id')) then
      v_v2 := v_v2 + 1;
      continue;
    end if;

    v_skip := coalesce((r->>'skip_follow_up')::boolean, false)
              or exists (select 1 from public.touch
                          where tenant_id = p_tenant and contact_id = v_contact and voided_at is null and occurred_at > v_at);
    v_id := null;
    insert into public.touch(tenant_id, occurred_at, user_id, contact_id, channel, direction, outcome, notes,
                             skip_follow_up, source, external_id)
    values (p_tenant, v_at, p_user, v_contact, 'email', r->>'direction', r->>'outcome', left(r->>'notes', 500),
            v_skip, p_source, r->>'external_id')
    on conflict (tenant_id, source, external_id) where external_id is not null do nothing
    returning id into v_id;
    if v_id is null then v_dupes := v_dupes + 1; else v_inserted := v_inserted + 1; end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'duplicates', v_dupes, 'already_in_v2', v_v2, 'invalid', v_invalid);
end $$;

revoke all on function public.mail_ingest(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.mail_ingest(uuid, uuid, text, jsonb) to service_role;
