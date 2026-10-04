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
5. **Inngest**: Inngest dashboard → Apps → *dilly* → "Resync" if functions changed; confirm the functions are listed (5 + `mail-sync-fanout`, `mail-sync-run`, `geocode-properties`).

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
| `SENTRY_DSN` | **TODO**, not wired | See `src/lib/observability/log.ts` (`setErrorReporter`). Browser errors already reach the logs (`msg:client:error`, §12) |
| `STORAGE_DRIVER` | Photos + card scans (§12). `supabase` (default) or `local` (dev/e2e only — never on Vercel) | Defaults to Supabase Storage, bucket `media` |
| `STORAGE_LOCAL_DIR` | only with `STORAGE_DRIVER=local`, default `<cwd>/.data/media` | — |
| `DILLY_GEOCODER` | optional; `off` disables Census geocoding (Route / Nearby) | Geocoding on (US Census, free, no key) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Push reminders to phones (§11) — `npx tsx scripts/gen-vapid.ts` | Reminders are still decided and recorded (`insight` rows) but not sent; Settings says phone reminders aren't switched on |
| `VAPID_SUBJECT` | optional, default `mailto:team@dillyos.com` | — |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Gmail sync (§10) | Email section hidden for reps; admins see "Email sync isn't configured yet" |
| `MAIL_TOKEN_KEY` | Gmail sync — 32 random bytes, base64 (`openssl rand -base64 32`) | Same as above. **Never rotate casually**: stored tokens become unreadable and every rep must reconnect |

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
| **Supabase (DB/Auth)** | `/app` redirects to sign-in with "Can't reach the server … try again"; open pages show "That didn't load — Try again / Go to Today" with a ref. Logs made on an open screen are saved on the phone ("Waiting for signal · N queued") and send by themselves when the DB answers. | Static shell, error screens. No data. | Check status.supabase.com and the Supabase dashboard. `/api/health` returns 503 with `db.ok:false` / `auth.ok:false`. Nothing to roll back on our side. Post in the team channel. |
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
- [ ] Inngest integration installed; all functions synced (incl. `geocode-properties`); failure alerts on.
- [ ] Storage bucket `media` exists and is **private**, with the three `dilly_media_*` policies (§12). On a phone: log a
      roof walk with a photo → it shows under the property's Photos.
- [ ] Airplane-mode test on a phone (§12): log at a stop with no signal → "Waiting for signal · 1 queued" → turn signal
      back on → the touch lands once.
- [ ] Gmail sync configured and verified with one FOX rep (§10).
- [ ] VAPID keys set (§11); on one iPhone (home-screen app) and one Android: Settings → Notifications → Turn on
      reminders → Send test notification arrives and opens Today.
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

## 10. Gmail sync

Carries over V2's "Connect your Gmail": emails to and from a rep's **existing contacts** log as `email` touches
(`source = 'gmail'`), and the follow-up engine closes / schedules tasks from them (a reply → "Respond to X",
priority 85, due next business day). We read **metadata only** (`gmail.metadata` scope: sender, recipients, subject,
date, labels) — never bodies. Mail with people who aren't contacts is counted in the run log, never stored. Outlook
is "coming soon" (`src/lib/mail/provider.ts` is the interface Microsoft Graph `Mail.ReadBasic` will implement).

**Google Cloud console** (do this before Monday — reps can't connect until it's done):

1. Use the **same Google Cloud project / OAuth client V2 used** (reps already trust it; it's what FOX's Workspace
   admin approved), or create one: APIs & Services → Credentials → Create credentials → OAuth client ID → *Web application*.
2. APIs & Services → Library → enable the **Gmail API**.
3. On the OAuth client → **Authorized redirect URIs** → add exactly `https://<app>/api/mail/google/callback`
   (the production URL = `NEXT_PUBLIC_APP_URL`; add the Preview URL too if you test there). Keep V2's URI if reusing.
4. OAuth consent screen → Scopes: `openid`, `email`, `.../auth/gmail.metadata`. **`gmail.metadata` is a
   restricted scope.** Until Google verifies the app (security assessment, weeks), leave Publishing status = **Testing**
   and add **every rep's Google address as a Test user** (max 100). Testing-mode grants expire after 7 days → reps would
   see "Reconnect Gmail" weekly; if V2's client is already verified / In production, reuse it to avoid that.
5. **Google Workspace admins (FOX `foxroofing.co`, TSG)**: Admin console → Security → Access and data control →
   **API controls → App access control → Manage third-party app access** → add the OAuth client ID → **Trusted**.
   V2 hit exactly this block on foxroofing.co ("Access blocked: … has not completed the Google verification process" /
   "admin has blocked"). Do this for each tenant's Workspace.
6. Copy the client ID + secret into Vercel (Production + Preview): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   and a new `MAIL_TOKEN_KEY` (`openssl rand -base64 32`). Redeploy. Resync Inngest.

**How it works**

- Settings → Email sync → *Continue with Google* (`/api/mail/google/start` → Google → `/api/mail/google/callback`).
  State is an HMAC-signed 10-minute token + httpOnly cookie. Refresh/access tokens are AES-256-GCM encrypted with
  `MAIL_TOKEN_KEY` before they reach the DB (the table rejects anything else); only the service role can read them;
  the browser only ever sees `public.my_mail_connection` (email, status, last synced, last error).
- First sync: last 30 days (no search query — the metadata scope forbids `q`; Promotions/Social/chats/drafts/spam are
  filtered by label). Mail older than 7 days logs without creating tasks. Then every 10 min (`mail-sync-fanout` →
  `mail-sync-run`) from the Gmail history cursor. ≤ 10 parallel fetches, ≤ 500 messages per run (continues next tick).
  Messages V2 already logged (migrated as `dillyv2` / `gmail:<id>`) are skipped, so cutover never double-logs.
- **Points**: inbound synced mail (replies, auto-replies, bounces) awards nothing; outbound awards `touch_logged`
  only, and only if sent in the last 24 h (no points for the backfill). Auto-replies/bounces don't close follow-ups;
  a bounce sets the contact's `email_status = 'bounced'`.
- Google removed access (`invalid_grant`: password change, revoked, Testing-mode expiry): the connection goes to
  `status = 'error'`, Settings and Today show "Reconnect Gmail — Google access was removed". Disconnect revokes at
  Google and wipes the tokens; touches already logged stay.

**Verify after deploy**

1. As a rep: Settings → Email sync → Continue with Google → approve → back on Settings with "Gmail connected".
2. Inngest → `mail-sync-run` → the run's output: `fetched`, `logged`, `unknownSenders`, `phase`. Logs: `msg:"mail:sync"`.
3. Send an email from that Gmail to a contact in Dilly → within 10 min (or *Sync now*) it shows on the contact's
   timeline as an email touch, and Today has "Follow up on email to …".
4. SQL editor: `select email, status, last_synced_at, last_sync_stats from public.mail_connection;`
   — `last_sync_stats` holds counts only. Errors: logs `mail:sync-failed`, `mail:sync-revoked`, `mail:oauth-callback-failed`.

## 11. Push notifications & PWA

Dilly installs to the home screen (manifest at `/manifest.webmanifest`, icons in `public/icons` from
`scripts/gen-icons.ts`) and delivers the reminder ladder (≤ 3 a day, inside the tenant's push window, weekdays unless
enabled — all decided in `rank.ts`) as Web Push.

**Setup (once per environment)**

1. `npx tsx scripts/gen-vapid.ts` → set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:team@dillyos.com`
   in Vercel (Production + Preview — or separate pairs). Redeploy.
2. **Keep the keys.** Rotating them invalidates every phone's subscription; reps would have to turn reminders back on.
3. `supabase db push` applies `20261004100500_push_subscription_and_phone_search.sql` (`push_subscription` table + RLS,
   `save_push_subscription()`, `contact.phone_digits`).

**What reps do on their phone (Monday)**

- **iPhone (iOS 16.4 or later — web push only works from the home-screen app):** open Dilly in **Safari** → Share →
  **Add to Home Screen** → open Dilly from the new icon and sign in → Settings → Notifications → **Turn on reminders**
  → Allow. Today shows a one-time "Add Dilly to your home screen" hint in Safari. In Chrome/Firefox on iPhone, or in
  Safari without installing, push isn't available and Settings explains the steps.
- **Android (Chrome):** open Dilly → ⋮ → **Install app** (or Add to Home screen) → Settings → Notifications →
  **Turn on reminders** → Allow. Works in the browser tab too.
- Then **Send test notification**. Each phone/browser is a separate device in "My devices"; remove old ones there.
- Blocked by mistake: iPhone Settings → Notifications → Dilly → Allow; Android: long-press the icon → App info →
  Notifications. Settings shows these steps when it detects the block.

**How it works**

- Reminders cron (every 30 min) → `runRemindersForRep` records the `insight` rows, then `src/lib/push/sender.ts` sends
  to every active `push_subscription` of the rep. Copy is specific and opens the item: "Call Dave back — Greystar
  Riverside" → `/app/accounts/<id>`; overdue group → Today. The push key is the notification tag, so a retried send
  replaces itself on the phone. Per-push results (`delivered`, `sent`, `failed`, `disabled`, `url`) are in the
  `record-reminders` step output of the agent run.
- 404/410 from the push service → the subscription is disabled (shows "Stopped" in My devices); other errors bump
  `failure_count` ("Not answering"). Logs: `push:send-failed`, `push:subscription-gone`.
- Service worker (`public/sw.js`, production builds only): precaches `/offline` + icons; cache-first for
  `/_next/static` and `/icons`; navigations are network-first with the `/offline` fallback. **Page HTML, API, server
  actions and Supabase responses are never cached.** Logging without signal is handled by the offline queue (§12), which
  lives in the page (IndexedDB), not the service worker — it works with the worker blocked or absent. Changing caching
  rules → bump `VERSION` in `sw.js`; old caches are deleted on activate. `/sw.js` is served `no-cache`.
- Kill switch: unset the VAPID env vars (reminders go back to record-only).

## 12. Field kit: offline logging, photos, card scan, route, browser errors

### Offline log queue
- A log made with no signal (`navigator.onLine` false, the request fails, or the server can't reach the DB) is saved on
  the phone in IndexedDB (`dilly-offline` → `logs`) with its idempotency key, its photos (as bytes) and the time it was
  tapped. The top bar shows **"Waiting for signal · N queued"**; the toast says the same.
- Replay: on the `online` event, when Dilly comes back to the foreground, on app open, and every 20 s while anything is
  waiting. In tap order; photos upload first, then the log with the **same** key (`touch.external_id = idem:<uuid>`), so a
  log that reached the server but whose answer was lost is recognised (unique index → the action returns the original
  touch) and never doubles. `occurred_at` is the tap time (rejected if > 30 days old); points and follow-ups follow it.
- A log the server rejects (record deleted, company left) stays on the phone as **"1 log to fix"**: tap the strip →
  Try again / Open the record / Discard. Logs only replay for the user who made them (shared phones are safe).
- Limits: logging offline works on a screen that's already open (Go, an account/property/contact page, Today's Log
  sheet for a record opened earlier). Opening a new screen with no signal shows `/offline`, which lists how many logs
  are waiting. Adding a contact and property photos (outside a log) need signal. Clearing Safari website data deletes
  anything still queued.

### Photos (Supabase Storage)
- Phones resize to ≤ 1600 px JPEG (~0.8) before upload; the canvas re-encode drops all EXIF (GPS included). Location is
  stored as `photo.lat/lng` only when the rep ticks "Save where photos were taken".
- `POST /api/media` (multipart, ≤ 6 MB, JPEG only) stores `<tenant_id>/yyyy/mm/<uuid>.jpg` in the private bucket
  `media`. Display uses 1-hour signed URLs. Photos logged with a touch go in `touch.media` and are copied to
  `public.photo` by the `touch_media` trigger; roof walks / inspections with photos earn `site_walk_completed` (+12).
- **Setup:** `supabase db push` creates the bucket and the `storage.objects` policies (`dilly_media_select/insert/update`,
  first path segment must be one of the user's tenants). If the push prints *"no privilege to manage storage
  policies"*, do it by hand: Storage → New bucket → name `media`, **Private**, 10 MB limit, `image/jpeg,image/png,image/webp`;
  then run the policy statements from `20261004300000_field_kit.sql` §4 in the SQL editor.
- Local dev / e2e: `STORAGE_DRIVER=local` writes to `.data/media` and serves files through the authenticated
  `/api/media/file/<key>` route (the local stack has no Storage API). Never set it on Vercel.

### Business-card scan
- "Scan business card" in every add-contact flow → resized photo → `/api/media` (kept as `contact.source_image_path`)
  → `scanBusinessCard` → Claude vision on the **sonnet** tier (`DILLY_MODEL_SONNET`) → zod-validated fields pre-fill the
  form; the company is matched to an account by normalized name, or offered as a new account.
- Without `ANTHROPIC_API_KEY` / `DILLY_MODEL_SONNET`, or on a timeout / bad answer, the rep sees why and types it in.
  Every scan is an `agent_run` (`agent_key = 'card-scan'`, cost in `cost_usd`). Logs: `card-scan`, `card-scan:failed`.

### Route for the day / Nearby
- Property pins come from the free **US Census geocoder**, server-side only (the browser never calls it; CSP unchanged).
  Cached on `property.lat/lng` with `geocoded_at`, `geocode_source` (`census`, `census_nomatch`, `census_error`,
  `manual`, `import`). An address edit clears the pin (trigger) and re-geocodes after the save. Inngest
  `geocode-properties` (hourly + `dilly/geocode.requested`) works through buildings without a pin, ≤ 5 req/s, 25 per
  step, resumable; errors retry after 6 h. Go also geocodes today's unpinned stops after the page renders.
- Backfill after an import: Inngest → send `dilly/geocode.requested` with `{}`.
- Go → **Route**: nearest-neighbour from the rep's location (or the first stop), straight-line miles between stops,
  "Open route in Google Maps" (multi-stop URL, no API key; > 10 stops split into legs). Properties → Sort: **Nearby**.

### Browser error reports
- `window.onerror`, unhandled rejections and every `error.tsx` boundary → batched `navigator.sendBeacon` to
  `POST /api/client-error` (≤ 16 KB, ≤ 10 errors per batch, 20 per IP burst then 1 per 3 s; 25 per page load). Logged
  as `level:error`, `msg:client:error`, with `requestId`, `user`/`tenant` ids, `release`, `url` (path only — query
  strings are dropped), `kind` (`error` / `unhandledrejection` / `boundary`) and the boundary `ref` the rep reads out.
  No names, emails or form contents are sent.

## 12. Import, undo, bulk assign, scorecard

- **Import** (`/app/import`, owners/admins/managers): the browser parses and plans; nothing is written until *Import N rows*.
  Commit runs in chunks (one RPC = one transaction each), tags rows with `import_batch_id`, and records `import_batch`.
  Dedupe: companies by normalized name; contacts by email, phone (last 10 digits), or name similarity ≥ 0.6 within the
  same company; properties by normalized street + city. A retried chunk never doubles rows.
- **Undo** (24 h, Import → Recent imports): deletes only rows that batch created and that have no touches, tasks,
  opportunities, flags, photos or preferences since; kept rows are listed. A batch stuck at *Incomplete* (browser closed
  mid-import) can be undone the same way. After 24 h: merge/delete by hand.
- **Bulk assign**: tasks follow the account owner — the previous owner's (and unassigned) open tasks on the account and
  its contacts move to the new owner; tasks another teammate holds stay. Every change is in `account_change`.
- **Scorecard definitions**: qualified meeting = touch with outcome *scheduled_inspection* / *met_decision_maker*, or a
  meeting / roof walk / inspection where someone was met. Paperwork = `account.paperwork_at` (first reach of
  *paperwork_received* or later; migrated V2 accounts already past it have no date). In person = Pace's in-person channels.
