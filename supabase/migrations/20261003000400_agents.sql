-- Dilly — agent runtime: registry, work queue, runs/steps, approval gates, trust, briefs, insights.

create table public.agent (
  key          text primary key,                 -- e.g. 'rep-daily-brief'
  name         text not null,
  pod          smallint not null check (pod between 0 and 6),
  description  text not null,
  default_tier text not null default 'opus' check (default_tier in ('opus','sonnet','haiku')),
  enabled      boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.work_item (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references public.tenant(id) on delete cascade,
  agent_key      text not null references public.agent(key),
  payload        jsonb not null default '{}'::jsonb,
  priority       smallint not null default 50,
  status         text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  run_after      timestamptz not null default now(),
  parent_run_id  uuid,
  dedupe_key     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index work_item_dedupe on public.work_item(agent_key, dedupe_key) where dedupe_key is not null and status in ('queued','running');
create trigger work_item_updated before update on public.work_item for each row execute function app.touch_updated_at();

create table public.agent_run (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references public.tenant(id) on delete cascade,
  agent_key        text not null references public.agent(key),
  work_item_id     uuid references public.work_item(id) on delete set null,
  trigger          text not null check (trigger in ('cron','signal','human','agent','event')),
  segment_id       uuid references public.segment(id),
  subject_user_id  uuid references public.profile(id),   -- e.g. the rep a brief is for
  inputs           jsonb not null default '{}'::jsonb,
  outputs          jsonb not null default '{}'::jsonb,
  proposed_actions jsonb not null default '[]'::jsonb,
  grade            jsonb,                               -- {score:'A'..'F', flags:[], rationale}
  status           text not null default 'running' check (status in ('running','succeeded','failed','needs_review')),
  error            text,
  input_tokens     int not null default 0,
  output_tokens    int not null default 0,
  cost_usd         numeric(10,4) not null default 0,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz
);
create index agent_run_tenant_idx on public.agent_run(tenant_id, agent_key, started_at desc);

create table public.agent_step (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.agent_run(id) on delete cascade,
  idx          smallint not null,
  name         text not null,
  model        text,
  tier         text check (tier in ('opus','sonnet','haiku','none')),
  output       jsonb,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  duration_ms  int,
  created_at   timestamptz not null default now(),
  unique (run_id, idx)
);

-- G1 outbound message · G2 estimate · G3 proposal · G4 legal · G5 recruiting · G6 spend · G7 publish · G8 bulk CRM change · G9 customer financial doc
create table public.approval (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  gate             text not null check (gate in ('G1','G2','G3','G4','G5','G6','G7','G8','G9')),
  agent_run_id     uuid references public.agent_run(id) on delete set null,
  action_type      text not null,
  summary          text not null,
  payload          jsonb not null,
  status           text not null default 'pending' check (status in ('pending','approved','edited','rejected','expired','auto_approved')),
  reviewer_user_id uuid references public.profile(id),
  edited_payload   jsonb,
  note             text,
  decided_at       timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index approval_queue_idx on public.approval(tenant_id, status, created_at);

create table public.trust_score (
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  agent_key     text not null references public.agent(key),
  gate          text not null,
  step_key      text not null default '*',
  approved      int not null default 0,
  edited        int not null default 0,
  rejected      int not null default 0,
  auto_approve  boolean not null default false,
  updated_at    timestamptz not null default now(),
  primary key (tenant_id, agent_key, gate, step_key)
);

create or replace function app.on_approval_decided() returns trigger language plpgsql security definer set search_path = public, app as $$
declare k text;
begin
  if new.status is distinct from old.status and new.status in ('approved','edited','rejected') then
    select agent_key into k from public.agent_run where id = new.agent_run_id;
    if k is not null then
      insert into public.trust_score(tenant_id, agent_key, gate) values (new.tenant_id, k, new.gate)
      on conflict do nothing;
      update public.trust_score set
        approved = approved + (new.status = 'approved')::int,
        edited   = edited   + (new.status = 'edited')::int,
        rejected = rejected + (new.status = 'rejected')::int,
        updated_at = now()
      where tenant_id = new.tenant_id and agent_key = k and gate = new.gate and step_key = '*';
    end if;
  end if;
  return new;
end $$;
create trigger approval_decided after update on public.approval for each row execute function app.on_approval_decided();

-- Rep Daily Brief output: one row per rep per day.
create table public.brief (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant(id) on delete cascade,
  user_id       uuid not null references public.profile(id) on delete cascade,
  for_date      date not null,
  headline      text not null,         -- "the one thing"
  lines         jsonb not null,        -- [{kind:'one_thing'|'due'|'new', text}]
  queue         jsonb not null,        -- ranked items with "why"
  agent_run_id  uuid references public.agent_run(id) on delete set null,
  seen_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, user_id, for_date)
);

create table public.insight (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references public.tenant(id) on delete cascade,
  agent_run_id  uuid references public.agent_run(id) on delete set null,
  kind          text not null,
  title         text not null,
  body          text not null,
  confidence    numeric(3,2),
  recommended_action text,
  status        text not null default 'open' check (status in ('open','acted','dismissed')),
  created_at    timestamptz not null default now()
);

-- Nightly rep-day snapshot: powers streaks ("days with follow-ups cleared") and trend charts.
create table public.rep_day (
  tenant_id        uuid not null references public.tenant(id) on delete cascade,
  user_id          uuid not null references public.profile(id) on delete cascade,
  day              date not null,
  touches          int not null default 0,
  first_touches    int not null default 0,
  in_person        int not null default 0,
  points           int not null default 0,
  tasks_completed  int not null default 0,
  overdue_eod      int not null default 0,
  cleared          boolean not null default false,
  primary key (tenant_id, user_id, day)
);
