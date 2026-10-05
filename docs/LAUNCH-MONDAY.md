# Monday launch — the short list

Everything below needs your accounts; the code is done and tested (316 unit/DB tests, 303 end-to-end tests against real Supabase Auth + PostgREST — green 3 runs in a row — and a strict production build). Budget ~60–90 minutes, in this order. Details for each step live in `docs/RUNBOOK.md`.

## 1. Code into GitHub (5 min)
Fastest: create an empty private repo (e.g. `dilly`), then attach it to the Claude session with push access and say "push it" — I push the full history.
Or yourself: download `dilly.bundle` from the chat → `git clone dilly.bundle dilly && cd dilly && git remote set-url origin <repo-url> && git push -u origin main`.

## 2. Supabase — NEW project (15 min)
1. Create project (region near Texas/Tennessee, e.g. us-east-1 or us-central). Turn on **PITR** (Pro plan) — non-negotiable for launch.
2. `npx supabase link --project-ref <ref>` → `npx supabase db push` (applies every migration; creates TSG + FOX, markets, invites, rules, and the private Storage bucket `media` for photos + card scans). Check Storage shows `media` as **Private**; if the push printed "no privilege to manage storage policies", create it by hand (RUNBOOK §12).
3. Auth → URL configuration: Site URL = your Vercel URL; redirect `<url>/auth/callback`. Email provider on.
4. Copy URL, anon key, service-role key.

## 3. Vercel (15 min)
1. Import the repo. Set env vars (`.env.example` lists all; RUNBOOK §2 marks which are required to boot):
   - Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`.
   - Agents: `ANTHROPIC_API_KEY`, `DILLY_MODEL_OPUS/SONNET/HAIKU` (current model ids). Without them briefs use the template — fine for day one.
   - Push: run `npx tsx scripts/gen-vapid.ts` once → `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:team@dillyos.com`.
   - Gmail: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAIL_TOKEN_KEY` (`openssl rand -base64 32`) — see step 5.
   - Photos: nothing to set (`STORAGE_DRIVER` defaults to Supabase Storage). **Don't** set `STORAGE_DRIVER=local` on Vercel.
   - Card scan uses `ANTHROPIC_API_KEY` + `DILLY_MODEL_SONNET`; without them reps type contacts in (the button says so).
2. Add the **Inngest** integration (sets its keys; the functions appear, incl. `geocode-properties`).
3. Deploy. Check `https://<app>/api/health` returns `200`.
4. Add an uptime monitor on `/api/health` (Vercel Monitoring or Better Stack, 1-minute checks, text alerts to you).

## 4. Smoke test (10 min)
Sign in as `team@dillyos.com` → TSG. Switch to FOX. Log a touch, see the follow-up on Today, change a property's manager, flag a leak. Sign in on your phone, Add to Home Screen, turn on notifications, send a test. Then on the phone: open Go, turn on **Airplane mode**, log a stop → the top bar says "Waiting for signal · 1 queued"; turn Airplane mode off → it sends once. Log a roof walk with a photo → it's under the property's Photos. Go → Route → Open route in Google Maps.

## 5. Gmail auto-logging (15 min, Google Cloud console)
Reuse the V2 OAuth client if it's already set up: enable Gmail API; add redirect `https://<app>/api/mail/google/callback`; if the app is in Testing, add each rep as a test user (tokens expire every 7 days in Testing — publish/verify when you can); in the **FOX and TSG Google Workspace admin consoles** mark the client **Trusted** (Security → API controls → App access control) — this is what blocked V2 on foxroofing.co. Reps then tap **Connect Gmail** in Settings.

## 6. FOX data from Dilly V2 (30 min, all in the Supabase SQL Editor — no installs)
Full click path: `migration/README.md`. Scripts: `migration/sql-editor/`. Each one: GitHub → open the file → **Copy raw file** → Supabase → **SQL Editor** → **+ New query** → paste → **Run**.
1. **NEW project** → `01-connect-v2.sql`: first fill in 3 values: host and user (`postgres.<v2-ref>`) from **V2 project → Connect → Session pooler**, and the V2 database password. Type the password only in the editor, never in a chat. Result: 51 tables, `v2_rows` = `copied_rows`. Clear the password from the tab, then run `05-drop-fdw.sql` (removes the stored connection).
2. `02-preflight.sql` → first row `PASS`. If it lists unmapped values (or several "fox" orgs), send me the error text; I update the maps and you re-run.
3. `03-transform.sql` → counts per entity.
4. `04-reconcile.sql` → **row 1 must say PASS**. Export the CSV and keep it.
5. Cutover: **V2 project** → `V2-freeze.sql`; **NEW project** → `06-delta.sql` (same 3 values), then `02` → `03` → `04` (PASS) → reps switch. Rollback: `V2-unfreeze.sql` in V2. V2 is paused after 90 days, never deleted.

**If V2 data isn't ready by Monday 8 AM:** launch TSG fresh Monday (nothing to migrate), keep FOX on V2 one more day, cut FOX over Monday night after reconcile passes. No rep loses data either way.

## 7. Load TSG's book (15 min)
Accounts → Import (or Settings → Import). Upload your Memphis spreadsheet (format example: `docs/samples/tsg-import-sample.csv`), check the auto-mapped columns, review duplicates in the preview, pick the default rep, Import. Undo is available for 24 hours. Then Accounts → Select → assign accounts to reps.

## 8. Rep rollout (Monday morning)
- Reps sign in with their work email (magic link or password) — invites are pre-seeded, they land in the right company.
- Phone: Safari → Share → Add to Home Screen (iPhone, iOS 16.4+ for notifications) / Chrome → Install app (Android). Settings → Notifications → Turn on.
- Settings → Connect Gmail.
- First brief arrives 6:00 AM local the next weekday once Anthropic keys are set.

## Known limits on day one
- Outlook sync not built (Gmail only).
- Offline: logs made with no signal on an open screen (Go, an account/property page) are saved on the phone with their photos and send by themselves — in order, never twice — when signal comes back ("Waiting for signal · N queued" in the top bar). Opening a *new* screen, adding a contact, and adding photos outside a log still need signal.
- Route distances are straight-line; buildings get map pins from the free Census geocoder (US addresses; new imports pin within the hour).
- Card scan needs the Anthropic key + `DILLY_MODEL_SONNET`; without them reps type contacts in.
- Browser-side errors reach the logs (`msg:client:error`); Sentry itself is still a TODO.
