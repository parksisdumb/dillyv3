# Dilly end-to-end suite (Playwright)

Real browser, real app (`next build && next start -p 3100`), real local Supabase-equivalent stack. No mocks.

```bash
# once: stack binaries (see scripts/local/stack/README.md); Postgres on :54329
STACK_BIN=<dir with auth + postgrest> ./scripts/local/stack/up.sh --fresh
# run everything (builds the app, seeds, logs in each persona, runs mobile → desktop → resilience)
STACK_BIN=<same dir> npm run e2e
npx playwright show-report test-results/e2e-report
```

- **Seed:** `npm run e2e:seed` (`scripts/e2e/seed.ts`). Idempotent: it wipes FOX and TSG business data and re-creates it from a deterministic plan relative to "now". That's 26 FOX + 10 TSG accounts, 96 contacts, 70 properties, 14 opportunities (including the 53-day $160K Lincoln proposal), 30 days of touches, and overdue tasks. Every persona's password is `e2e-password-1`.
- **Personas** (`tests/e2e/.auth/*.json`, written by `global-setup.ts` through the real /login UI): parks (FOX admin + platform admin), tyler (manager), colby and kayla (reps), team@dillyos.com (TSG owner), e2e-tsg-rep@thesvcgroup.com. Ben and Dylan are signed-up but never-claimed invites, used by the auth specs.
- **Projects:** `mobile` (390×844, touch) runs every spec. `desktop` (1280×800) runs team/a11y/visual. `resilience` stops and restarts the stack gateway, so it runs last and on its own.
- **Isolation:** mutating tests create their own rows through `support/db.ts`, with unique names, so specs run in parallel and can be re-run.
- **Schema drift:** when `supabase/migrations` changes, global setup runs `up.sh --fresh` (needs `STACK_BIN`). `E2E_FRESH=1` forces it and `E2E_FRESH=0` skips it.
- **Server-side latency:** the app talks to Supabase only from the server, so `page.route` can't slow it down. The app is pointed at `scripts/e2e/latency-proxy.mjs` (:54331 → :54321), which the resilience spec tells to add 3 s to `/rest/v1`. `E2E_DIRECT=1` bypasses the proxy.
- **Build:** `scripts/e2e/serve.mjs` builds from a copy of the repo in `/tmp/dilly-e2e-app`, so it never clobbers your `.next`. It is the strict production build (type errors fail it); `E2E_TYPECHECK=0` skips type checking for a tree mid-change. `E2E_REUSE_SERVER=1` reuses a server already running on :3100.
- **Screens for review:** `test-results/e2e/screens/<project>/*.png`. **Known bugs:** `BUGS.md` (each one is a `test.fixme`).
