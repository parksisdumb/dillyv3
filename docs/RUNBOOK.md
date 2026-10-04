# Dilly — Production Runbook

The goal: **the app does not go down**, and when a dependency does, reps see a calm screen with
"Try again" and their logged work is safe.

- App: Next.js 15 on Vercel. DB/Auth: Supabase. Crons/agents: Inngest. LLM: Anthropic.
- Health: `GET /api/health` — point every uptime monitor here.
- Logs: one JSON line per event in Vercel → Logs (filter by `level:error`, `msg`, `requestId`).

---

## 1. Deploy steps

1. **Pre-flight on the branch** (all must pass):
   ```bash
   npx tsc --noEmit
   npx eslint src tests --max-warnings=0
   ./scripts/local/reset-db.sh && npx vitest run      # full suite incl. tests/db
   npx next build
   ```
2. **Database first, app second.** Migrations are additive on launch week (see §5), so the old app keeps
   working against the new schema:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push --dry-run     # read the list; only expected files
   npx supabase db push
   ```
3. **Merge → Vercel builds Preview → Production.** Watch the deployment's Functions logs for 5 minutes.
4. **Smoke test production** (phone, cellular, not Wi-Fi):
   - `curl -s https://<app>/api/health` → `200` and `"ok":true`, `version` = the commit you shipped.
   - Sign in → Today renders with the queue → log one touch → toast shows points.
   - Accounts, Go, Pipeline open; Team opens for a manager.
5. **Inngest**: Inngest dashboard → Apps → *dilly* → "Resync" if functions changed; confirm the functions are listed (5 at launch).

## 2. Environment variables

Set in Vercel → Project → Settings → Environment Variables (Production *and* Preview).
Empty values are treated as unset (they never crash boot).

| Variable | Needed for | If missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Boot** | Every page errors; `/api/health` → 503 `not_configured` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Boot** | Same as above |
| `SUPABASE_SERVICE_ROLE_KEY` | Crons, agents | App works; briefs/reminders/close-of-day fail (logged) |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Crons | Set by the Inngest Vercel integration. App works; no crons |
| `ANTHROPIC_API_KEY` | LLM briefs | Briefs use the deterministic template (by design) |
| `DILLY_MODEL_OPUS` / `_SONNET` / `_HAIKU` | LLM briefs | Same as above |
| `NEXT_PUBLIC_APP_URL` | Magic-link emails | Falls back to request headers; **set it** to the production URL |
| `DILLY_SUPABASE_TIMEOUT_MS` | optional, default 8000 | Per-attempt DB timeout |
| `DILLY_LLM_TIMEOUT_MS` | optional, default 30000 | Per-call Anthropic timeout |
| `LOG_LEVEL` | optional, default `info` | — |
| `SENTRY_DSN` | **TODO**, not wired | See `src/lib/observability/log.ts` (`setErrorReporter`) |

Vercel provides `VERCEL_GIT_COMMIT_SHA` (shown as `version` in `/api/health`) and `VERCEL_REGION`.
Pin the Vercel function region to the one closest to the Supabase region (Project → Settings → Functions).

## 3. Rolling back

- **App**: Vercel → Deployments → the last good deployment → **⋯ → Instant Rollback**. Takes seconds,
  no rebuild. Do this first, investigate second.
- **Database**: migrations are additive, so an app rollback never needs a DB rollback. If data was damaged,
  use Supabase **Point-in-Time Recovery** (Database → Backups → PITR) to restore to a timestamp *before*
  the incident — this restores the whole database, so coordinate and announce it.
- **Inngest**: a bad cron can be paused per function in the Inngest dashboard (Functions → ⋯ → Pause).

## 4. Backups

- Supabase → Database → Backups: **enable PITR** (Pro plan add-on) before launch. Daily backups alone lose
  up to 24 h of touches.
- Once a week, check the latest backup timestamp is < 24 h old.

## 5. Migration discipline (launch week)

- **Additive only**: new tables, new nullable columns, new indexes (`create index if not exists`),
  `create or replace` for functions/views with identical columns. No drops, renames, type changes or
  `not null` on existing columns.
- New tenant tables: use the cheap RLS form introduced in `20261004000500_performance.sql`:
  `using (tenant_id = any ((select app.my_tenant_ids())::uuid[]))` — not `app.is_member(tenant_id)`,
  which runs a function per row (it was 3–9 s on 50k touches).
- If you redefine `account_ranked` or `rep_queue`, start from the **latest** definition (lateral aggregates;
  `with d as materialized`) — copying the original from `20261003000500_logic.sql` silently brings back
  the slow version. Re-run `scripts/local/loadtest.sql` after.
- Every migration runs locally first: `./scripts/local/reset-db.sh && npx vitest run tests/db`.

## 6. When a dependency is down

| What's down | What reps see | What keeps working | What to do |
|---|---|---|---|
| **Anthropic** | Nothing different. | Everything. Briefs fall back to the deterministic template (LLM calls time out at 30 s; `fallbackReason` is logged). | Nothing. Optionally check status.anthropic.com. |
| **Inngest** | Today/Go/Accounts work. The 06:00 brief and reminders don't arrive; streaks don't close at 23:00. | All screens, logging, follow-up engine (it's a DB trigger, not a cron). | Wait. When Inngest recovers, crons resume. Close a missed day manually: send `close_rep_day` RPC via SQL editor: `select public.close_rep_day('<tenant>', '<yyyy-mm-dd>');` (idempotent). Rebuild a brief: send event `dilly/rep-daily-brief.requested`. |
| **Supabase (DB/Auth)** | `/app` redirects to sign-in with "Can't reach the server … try again"; open pages show "That didn't load — Try again / Go to Today" with a ref. Logging returns "No signal — tap again. It won't double-log." | Static shell, error screens. No data. | Check status.supabase.com and the Supabase dashboard. `/api/health` returns 503 with `db.ok:false` / `auth.ok:false`. Nothing to roll back on our side. Post in the team channel. |
| **Vercel** | Site unreachable. | — | status.vercel.com. Nothing to do on our side. |

Reps' double-taps and retries after a dropped connection are safe: each log carries an idempotency key
stored in `touch.external_id` (`idem:<uuid>`); a repeat hits the unique index and returns the original touch.

## 7. Monitoring setup

1. **Uptime** (Better Stack, UptimeRobot, or Vercel Monitoring): HTTP check on
   `https://<app>/api/health` every 1 min, alert on non-200 or > 5 s, from 2+ regions; alert after 2
   consecutive failures. Response shape:
   ```json
   {"ok":true,"version":"<sha>","region":"iad1","db":{"ok":true,"latencyMs":23},"auth":{"ok":true,"latencyMs":41},"time":"…"}
   ```
   `503` when the database or auth is unreachable (reason codes only: `timeout`, `unreachable`, `error`,
   `http_<status>`, `not_configured` — never secrets). `"db":{"ok":true,"reason":"health_fn_missing"}` means
   the DB answered but `20261004000500_performance.sql` isn't applied — run `supabase db push`.
2. **Error logs**: Vercel → Logs, saved query `level:error`. Useful `msg` values:
   - `boundary` / `boundary:global` — a page failed to render (client-side; `ref` is what the rep reads out).
   - `safe:<widget>` — a card degraded (e.g. `safe:today:leaderboard`); the page still rendered.
   - `supabase:timeout`, `supabase:network`, `supabase:retry` — DB slowness.
   - `middleware:auth-unavailable` — auth couldn't be reached; reps saw the offline notice.
   - `action:db`, `action:logTouch` — server action failures.
   - `inngest:<fn>:tenant-failed` — one tenant's cron slice failed; others continued.
   - `health:degraded`.
   A rep's "ref" is the first 8 chars of the server error digest or client id — search logs for it.
   Every server log line carries `requestId` (also returned as the `x-request-id` response header).
3. **Log drain** (optional): Vercel → Settings → Log Drains → Better Stack/Datadog for retention > 1 day.
4. **Inngest**: enable failure notifications (Inngest → Settings → Alerts) for function failures.
5. **Supabase**: Reports → Database: watch CPU and slow queries the first week.

## 8. Pre-launch checklist

- [ ] All checks in §1.1 pass on the release commit.
- [ ] `supabase db push` applied; `select public.health();` works in the SQL editor.
- [ ] Supabase PITR enabled; latest backup < 24 h.
- [ ] Supabase Auth → URL config: Site URL = production URL; `<url>/auth/callback` in redirect URLs.
- [ ] Vercel env vars set for Production (§2); `NEXT_PUBLIC_APP_URL` = production URL.
- [ ] Vercel function region matches the Supabase region.
- [ ] Inngest integration installed; all functions synced (5 at launch); failure alerts on.
- [ ] Uptime monitor on `/api/health` alerting to a phone.
- [ ] Vercel saved log query `level:error`.
- [ ] Production smoke test on a phone over cellular (§1.4), including a double-tap on a Log outcome
      (one touch recorded).
- [ ] Know who holds the Vercel "Instant Rollback" button Monday morning.

## 9. Performance reference

Measured with `scripts/local/loadtest.sql` (one tenant: 2,000 accounts, 10,000 contacts, 8,000 properties,
50,000 touches, 5,000 tasks; RLS on, as a rep; warm cache, local Postgres 16):

| Query | Before | After |
|---|---:|---:|
| Accounts list — mine | 249 ms | 7 ms |
| Accounts list — all (rank order) | 3,926 ms | 113 ms |
| Accounts search | 817 ms | 42 ms |
| Account detail | 3 ms | 1 ms |
| `rep_queue` (Today) | 171 ms | 7 ms |
| Team cold list | 79 ms | 4 ms |
| Leaderboard (week) | 9,002 ms | 88 ms |
| Touch timeline (recent 40) | 2,991 ms | 0.1 ms |
| Properties — city filter | 441 ms | 6 ms |
| Properties — address search | 446 ms | 7 ms |

What changed (`20261004000500_performance.sql`): RLS membership evaluated once per statement
(`app.my_tenant_ids()` InitPlan) instead of a SECURITY DEFINER call per row; `FOR ALL` write policies
likewise (they're OR'd into reads); `account_ranked` aggregates via LATERAL so each runs once per row
(the inlined CTEs re-ran them up to 3×); `rep_queue` computes "today" once; hot-path indexes.

Reproduce:
```bash
DB=dilly_perf ./scripts/local/reset-db.sh
psql "postgresql://postgres@localhost:54329/dilly_perf?host=/tmp" -f scripts/local/loadtest.sql
```
