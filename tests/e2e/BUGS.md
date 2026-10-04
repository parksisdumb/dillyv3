# Dilly E2E — bugs (Monday launch triage)

Last full run (strict `next build`, all projects): **268 passed, 1 fixme (B9), 0 failed**.
Also green: `npx tsc --noEmit`, `npx eslint src tests --max-warnings=0`, `npx vitest run` (21 files / 168 tests).

## Open

<a id="b9"></a>
### B9 — Major: some taps on links that stay on the same screen don't navigate (needs the owner's OK to fix)
- **What a rep sees:** some taps on a link that stays on the same screen do nothing. This covers contact/account filters, "Everyone's" and "Look in everyone's contacts". It hits about 1 tap in 4, and tapping again works. Moving between screens (bottom tabs, opening a record) is not affected.
- **Root cause:** the route-level `loading.tsx` files added in the reliability pass, together with Next 15.5 streaming. The RSC response arrives complete and returns 200, but the router transition never commits, so the URL and screen stay where they were. The router itself stays alive: the next navigation works.
- **Evidence** (`tests/e2e/navigation.spec.ts`, 24 tries per build):
  - With `loading.tsx`: 5–8 of 24 hang.
  - With all `loading.tsx` removed: 0 of 48.
  - With Link prefetch off, `clientSegmentCache`, `compress:false` or blocking metadata (`htmlLimitedBots`): no change.
- **Fix:** delete the 15 `src/app/app/**/loading.tsx` files and `src/components/status/skeletons.tsx`. I tried, and the session's safety check blocked file deletion, so this needs the owner's go-ahead. Keep slow-network feedback some other way, e.g. `useLinkStatus()` in the bottom nav.
- **Mitigations already in place:**
  - Saves no longer redirect to the page you're already on. Editing an opportunity now returns "Saved · <stage>" instead.
  - ActionForm doesn't depend on a navigation.
- **Test:** `navigation.spec.ts` (fixme).

## Fixed in this round (regression tests un-fixme'd)

| Bug | Root cause | Fix | Test |
|---|---|---|---|
| **B1** ActionForm saves stuck on "Saving…" (~50%) | `useActionState` dispatched through the global `startTransition`. Every action ends with `revalidatePath("/app","layout")`, so the dispatch was entangled with the router's own update for the response. When that update stalled (see B9), the action never settled. The Log sheet and Done/Snooze/Drop use a component `useTransition` and never hung. | `src/components/ui/action-form.tsx` calls the action inside its own `useTransition` and keeps state with `useState`. A network failure now shows inline instead of throwing. 0/10 stuck (was ~5/10). | `action-refresh.spec.ts` |
| **B2** Save profile → "infinite recursion detected in policy for relation profile" | The `profile_update` WITH CHECK selected from `profile` inside a `profile` policy (42P17). | New migration `20261004001200_rls_fast_ownership_and_profile_fix.sql`: `is_platform_admin = app.is_platform_admin()` (SECURITY DEFINER). | `me-settings.spec.ts`, `tests/db/rls-followups.test.ts` |
| **B4** No toast after Approve / Mark won / Mark lost | The toast ran in a `useEffect` of a form that unmounts on success. | ActionForm toasts from the submit handler. | `team.spec.ts`, `pipeline.spec.ts` |
| **B5** No `<h1>` on Today, Accounts, Contacts, Properties | — | `sr-only` h1 in `TodayView` and `BookTabs`. | `a11y.spec.ts` |
| **B6** Other company's record answered HTTP 200 | `notFound()` ran inside a `loading.tsx` Suspense boundary, after the 200 status had already been sent. | `[id]/layout.tsx` + `requireRecord()` check the record outside the boundary. Pages moved into `(list)` / `[id]/(detail)` route groups so the list skeleton doesn't wrap `[id]`. | `tenancy.spec.ts`, `ownership.spec.ts` |
| **B7** Drop says "Snoozed 0 times" | The Drop prompt reused the over-snoozed copy. | Copy only mentions snoozes when the task is worn out. | `today.spec.ts` |
| **B8** Log with Supabase down → bounced to sign-in | `getSession()` `redirect()`ed from inside the server action. | Inside a server action (has `next-action`) it throws instead. The sheet shows "Couldn't load. Check signal and try again." and the rep stays on Today. | `resilience.spec.ts` |

## Notes
- When Supabase is down, page navigation goes to `/login?offline=1`, which shows "Can't reach the server … you're probably still signed in" and a Try again link. This is the designed behaviour, and resilience checks that it recovers with no re-login.
