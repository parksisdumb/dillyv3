# Monday launch — the short list

Everything below needs your accounts; the code is done and tested (220 unit/DB tests, 283 end-to-end tests against real Supabase Auth + PostgREST, strict production build). Budget ~60–90 minutes, in this order. Details for each step live in `docs/RUNBOOK.md`.

## 1. Code into GitHub (5 min)
Fastest: create an empty private repo (e.g. `dilly`), then attach it to the Claude session with push access and say "push it" — I push the full history.
Or yourself: download `dilly.bundle` from the chat → `git clone dilly.bundle dilly && cd dilly && git remote set-url origin <repo-url> && git push -u origin main`.

## 2. Supabase — NEW project (15 min)
1. Create project (region near Texas/Tennessee, e.g. us-east-1 or us-central). Turn on **PITR** (Pro plan) — non-negotiable for launch.
2. `npx supabase link --project-ref <ref>` → `npx supabase db push` (applies every migration; creates TSG + FOX, markets, invites, rules).
3. Auth → URL configuration: Site URL = your Vercel URL; redirect `<url>/auth/callback`. Email provider on.
4. Copy URL, anon key, service-role key.

## 3. Vercel (15 min)
1. Import the repo. Set env vars (`.env.example` lists all; RUNBOOK §2 marks which are required to boot):
   - Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.
   - Agents: `ANTHROPIC_API_KEY`, `DILLY_MODEL_OPUS/SONNET/HAIKU` (current model ids). Without them briefs use the template — fine for day one.
   - Push: run `npx tsx scripts/gen-vapid.ts` once → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:team@dillyos.com`.
   - Gmail: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAIL_TOKEN_KEY` (`openssl rand -base64 32`) — see step 5.
2. Add the **Inngest** integration (sets its keys; 7 functions appear).
3. Deploy. Check `https://<app>/api/health` returns `200`.
4. Add an uptime monitor on `/api/health` (Vercel Monitoring or Better Stack, 1-minute checks, text alerts to you).

## 4. Smoke test (10 min)
Sign in as `team@dillyos.com` → TSG. Switch to FOX. Log a touch, see the follow-up on Today, change a property's manager, flag a leak. Sign in on your phone, Add to Home Screen, turn on notifications, send a test.

## 5. Gmail auto-logging (15 min, Google Cloud console)
Reuse the V2 OAuth client if it's already set up: enable Gmail API; add redirect `https://<app>/api/mail/google/callback`; if the app is in Testing, add each rep as a test user (tokens expire every 7 days in Testing — publish/verify when you can); in the **FOX and TSG Google Workspace admin consoles** mark the client **Trusted** (Security → API controls → App access control) — this is what blocked V2 on foxroofing.co. Reps then tap **Connect Gmail** in Settings.

## 6. FOX data from Dilly V2 (needs you for 10 min, then me)
`migration/README.md`. You run step 1–2 (`01-dump.sh`, `02-discover.sh`) with the V2 database URL (Supabase → V2 project → Settings → Database → connection string) and send me `legacy-schema.md` (or attach the dillyv2 repo). I confirm the column map, then: restore → transform → reconcile (must show zero FAIL) → freeze V2 → delta → reps switch. V2 is paused, never deleted.

**If V2 data isn't ready by Monday 8 AM:** launch TSG fresh Monday (nothing to migrate), keep FOX on V2 one more day, cut FOX over Monday night after reconcile passes. No rep loses data either way.

## 7. Rep rollout (Monday morning)
- Reps sign in with their work email (magic link or password) — invites are pre-seeded, they land in the right company.
- Phone: Safari → Share → Add to Home Screen (iPhone, iOS 16.4+ for notifications) / Chrome → Install app (Android). Settings → Notifications → Turn on.
- Settings → Connect Gmail.
- First brief arrives 6:00 AM local the next weekday once Anthropic keys are set.

## Known limits on day one
- Outlook sync not built (Gmail only). Map/GPS on Go not built (stops grouped by city with Directions).
- Offline: the app shows a clear "No signal" screen; logs made offline are not queued — reps re-log when back in signal.
- Browser-side errors go to logs only (Sentry hook is a TODO).
