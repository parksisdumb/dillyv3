# Dilly E2E — bugs (Monday launch triage)

Last full run (strict `next build`, all projects): **269 passed, 0 failed, 0 fixme**.
Also green: `npx tsc --noEmit`, `npx eslint src tests --max-warnings=0`, `npx vitest run` (21 files / 168 tests).

## Open

None.

## Fixed in this round (regression tests un-fixme'd)

| Bug | Root cause | Fix | Test |
|---|---|---|---|
| **B9** ~1 in 4 same-screen navigations (filters, "Everyone's", search, refresh after save) never committed: RSC response arrived, URL/screen didn't change | Route-level `loading.tsx` Suspense boundaries under Next 15.5. Measured with 24/48-tap harnesses: 5–8/24 hang with them; 0/48 without. Neither prefetch off, `clientSegmentCache`, `compress:false`, blocking metadata, `router.push` in a `useTransition` filter link, nor nesting the page one segment deeper helped | Every `loading.tsx` removed (first replaced by page-level keyed Suspense skeletons; those caused B10 and were replaced by `pageBody()` + `NavProgress`). 0/96 hangs | `navigation.spec.ts` |
| **B10** For ~150–400 ms after every full page load (reload, opening a link) the whole screen existed twice in the DOM: the visible page plus a hidden copy in `<div hidden id="S:0">`. `getByText` hit strict-mode violations at random (pipeline Won, Do not pursue, account-level log, link a contact) | The page-level keyed `<Suspense>` skeleton (the B9 fix). React Fizz outlines any completed boundary over ~12.8 KB (`progressiveChunkSize`, not configurable in Next) into a hidden segment and reveals it with a batched `$RC`/`$RV` (rAF / up to 300 ms later); hydration had already rendered the boundary, so the hidden segment lingered next to the live copy. Every screen is > 12.8 KB | Pages render with no page-level Suspense: `pageBody()` (`src/components/status/page-boundary.tsx`) awaits the body and keys it (`<div class="contents" key>`) so filter/record changes still remount. Same client tree for document loads, navigations, refresh and action revalidation. Navigation feedback is `NavProgress` (top progress bar + `main[aria-busy]`) instead of skeletons. B9 stays fixed (no `loading.tsx`, no boundary to stall a commit) | `field-kit.spec.ts` "never holds a second, hidden copy", `navigation.spec.ts`, `resilience.spec.ts` |
| **B1** ActionForm saves stuck on "Saving…" (~50%) | `useActionState` dispatched through the global `startTransition`. Every action ends with `revalidatePath("/app","layout")`, so the dispatch was entangled with the router's own update for the response. When that update stalled (see B9), the action never settled. The Log sheet and Done/Snooze/Drop use a component `useTransition` and never hung. | `src/components/ui/action-form.tsx` calls the action inside its own `useTransition` and keeps state with `useState`. A network failure now shows inline instead of throwing. 0/10 stuck (was ~5/10). | `action-refresh.spec.ts` |
| **B2** Save profile → "infinite recursion detected in policy for relation profile" | The `profile_update` WITH CHECK selected from `profile` inside a `profile` policy (42P17). | New migration `20261004001200_rls_fast_ownership_and_profile_fix.sql`: `is_platform_admin = app.is_platform_admin()` (SECURITY DEFINER). | `me-settings.spec.ts`, `tests/db/rls-followups.test.ts` |
| **B4** No toast after Approve / Mark won / Mark lost | The toast ran in a `useEffect` of a form that unmounts on success. | ActionForm toasts from the submit handler. | `team.spec.ts`, `pipeline.spec.ts` |
| **B5** No `<h1>` on Today, Accounts, Contacts, Properties | — | `sr-only` h1 in `TodayView` and `BookTabs`. | `a11y.spec.ts` |
| **B6** Other company's record answered HTTP 200 | `notFound()` ran inside a `loading.tsx` Suspense boundary, after the 200 status had already been sent. | `[id]/layout.tsx` + `requireRecord()` check the record outside the boundary. Pages moved into `(list)` / `[id]/(detail)` route groups so the list skeleton doesn't wrap `[id]`. | `tenancy.spec.ts`, `ownership.spec.ts` |
| **B7** Drop says "Snoozed 0 times" | The Drop prompt reused the over-snoozed copy. | Copy only mentions snoozes when the task is worn out. | `today.spec.ts` |
| **B8** Log with Supabase down → bounced to sign-in | `getSession()` `redirect()`ed from inside the server action. | Inside a server action (has `next-action`) it throws instead. The sheet shows "Couldn't load. Check signal and try again." and the rep stays on Today. | `resilience.spec.ts` |

## Notes
- When Supabase is down, page navigation goes to `/login?offline=1`, which shows "Can't reach the server … you're probably still signed in" and a Try again link. This is the designed behaviour, and resilience checks that it recovers with no re-login.
