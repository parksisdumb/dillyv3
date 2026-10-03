# Dilly

Business-development OS for commercial roofing: rep app (Today, Go, Accounts, Pipeline, Team) plus an agent runtime. Multi-tenant from day one. Current tenants: **TSG** (The Service Group, Memphis launch) and **FOX Roofing** (Austin / DFW).

Spec lives in the "Go To Market System/App" project (`gtm-agent-system/00-ARCHITECTURE.md` … `09-DATA-MIGRATION-PLAN.md`).

## What's in v0.1

| Area | Where | Notes |
|------|-------|-------|
| Schema | `supabase/migrations/` | Tenancy, CRM, touch ledger (append-only), tasks, outcome rules, points, targeting/preferences, agents, approvals G1–G9, RLS. |
| Follow-up engine | `20261003000300_activity.sql` | Any touch closes the contact's/account's open follow-ups and schedules the next one from `outcome_rule`. Fixes V2's 0% completion. |
| Gamification v2 | `point_rule`, `point_event`, `rep_day` | Outcome-weighted points, anti-farming, streak = cleared weekdays, badges. |
| Ranking | `account_ranked` view | Base score × tenant targeting × account preference; excluded accounts stay visible with a reason. |
| Screens | `src/app/app/**`, `src/components/**` | 3-tap Log sheet, Today queue + brief, Go (field session + call focus), Accounts, Pipeline, Team, Approvals, Me, Settings. |
| Agents | `src/agents/**`, `src/inngest/**` | Runtime (runs, steps, cost, grading, gates) + Rep Daily Brief end to end with a deterministic fallback. Crons: brief fan-out 06:00 local, reminders, close-of-day/streaks, manager escalations. |
| Migration | `migration/` | V2 → new copy-never-move kit: dump, discover, restore to `legacy`, transform, reconcile, freeze, delta. See `migration/README.md`. |
| Preview | `/preview/<screen>` | Fixture-backed screens for design review; 404 unless `DILLY_PREVIEW=1`. |

## Setup (when you're at the computer — ~30 min)

1. **Supabase**: create a NEW project (not the Dilly V2 one). Settings → API: copy URL, anon key, service-role key.
2. **Apply schema**: `npx supabase link --project-ref <ref>` then `npx supabase db push` (runs every file in `supabase/migrations`). This also creates TSG/FOX, markets, and invites.
3. **Auth**: Authentication → URL configuration: Site URL = your Vercel URL; add `<url>/auth/callback` to redirect URLs. Email provider on (magic link + password).
4. **Vercel**: import the repo, set env vars from `.env.example` (`DILLY_MODEL_*` = current Claude model ids for Opus/Sonnet/Haiku).
5. **Inngest**: add the Inngest integration in Vercel (sets event/signing keys); it discovers `/api/inngest`.
6. **Sign in** as `team@dillyos.com` or `parks@foxroofing.co` → you're platform admin and see both tenants. FOX reps sign in with their foxroofing.co emails and land in FOX automatically (invites seeded from the V2 roster).
7. **Migrate FOX data**: follow `migration/README.md` (dump → discover → confirm the column map → restore → transform → reconcile).

## Local development

```bash
npm install
cp .env.example .env.local      # fill in Supabase + Anthropic
npm run dev
npm test                        # needs local Postgres for tests/db + tests/migration (see scripts/local/)
npm run db:reset                # applies shim + migrations to a local Postgres on :54329
npm run db:types                # regenerates src/lib/db/database.types.ts from the database
```

## Known gaps (v0.1)

- Push delivery for reminders is stubbed (decisions are recorded as `insight` rows).
- Gmail/Outlook sync not yet ported from V2 (reps re-consent once it lands).
- Go has no map/GPS yet — stops grouped by city with Directions links.
- Migration column map is a best guess until the V2 schema is confirmed by `migration/02-discover.sh`.
- Signal-triggered pushes need an event trigger (cron is 30 min).
