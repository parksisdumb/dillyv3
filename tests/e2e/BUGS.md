# Dilly E2E — known bugs (Monday launch triage)

Found by `npx playwright test` against the local Supabase-equivalent stack (real GoTrue + PostgREST, seeded FOX + TSG data),
build of the working tree as of 2026-10-04 ~07:30 UTC. Each bug has a `test.fixme` that links back here, so the suite stays
green-on-known. When a fix lands, flip the matching `test.fixme` back to `test`.

Last full run: **240 passed, 16 fixme (known), 0 failed** across projects mobile / desktop / resilience.

No **blockers** found: sign-in, tenancy fencing, the 3-tap log + follow-up auto-close, Today, Go, Accounts, Pipeline and Team all work.

---

## Major

<a id="b1"></a>
### B1 — ActionForm saves hang on "Saving…" about half the time (data IS saved)
- **Where:** every form built on `src/components/ui/action-form.tsx` (dispatch via `startTransition(() => dispatch(fd))`, line 55, with `useActionState`, line 35): link contact↔property, Approvals approve/reject, opportunity Save / Mark won / Mark lost, Settings (team goal, targeting, invites), account preference.
- **Steps:** as Colby open any property → `+ Link a contact` → pick a contact → `Link contact`.
- **Expected:** the list shows the person, the button goes back to "Link contact" and a toast says "Linked".
- **Actual:** in ~3 of 6 tries the POST returns 200 in ~150 ms and the row is written, but the button stays **"Saving…"** indefinitely (40 s+). No toast, no list update. Reload shows the change. Same thing seen on Approve (the item stays in the list) and opportunity Save (old stage on screen). Reproduces with a single worker, so it isn't load.
- **Not affected:** the Log sheet (calls `router.refresh()` itself) and Today's Done/Snooze/Drop (plain `useTransition`) — 100% reliable over all runs.
- **Suspect:** `useActionState` dispatch + `revalidatePath("/app", "layout")` in the action. The RSC refresh that comes with the action response sometimes never commits, which leaves the transition pending.
- **Fix suggestion:** have ActionForm await the action itself in `useTransition`, the way TaskActions does: `start(async () => { const r = await action(prev, fd); setState(r); router.refresh(); })`. Or narrow `revalidatePath` to the page.
- **Test:** `tests/e2e/action-refresh.spec.ts` (fixme). Other specs now check the database and then reload, so they still cover the save itself.
- **Screenshot:** `tests/e2e/bug-shots/b1-action-stuck-saving.png`

<a id="b2"></a>
### B2 — Settings → Save profile fails for everyone: "infinite recursion detected in policy for relation profile"
- **Where:** `supabase/migrations/20261003000600_rls.sql:59`: the `profile_update` WITH CHECK runs `select p.is_platform_admin from public.profile p …`, a subquery on `profile` inside a `profile` policy (Postgres 42P17).
- **Steps:** any user → `/app/settings` → change Mobile → `Save profile`.
- **Expected:** "Profile saved". **Actual:** red alert `Couldn't save your profile: infinite recursion detected in policy for relation "profile"`.
- **Fix suggestion:** `with check (id = auth.uid() and is_platform_admin = app.is_platform_admin())`. The function is SECURITY DEFINER, so there's no recursion.
- **Test:** `me-settings.spec.ts` › "Settings: saving my profile (mobile number) works" (fixme).
- **Screenshot:** `tests/e2e/bug-shots/b2-profile-rls-recursion.png`

---

## Minor

<a id="b4"></a>
### B4 — No success toast when the form disappears on success (Approve, Mark won/lost)
- **Where:** `action-form.tsx:39` shows the toast in a `useEffect` on the new state. When the success re-render unmounts the form (the approval leaves the list, or the opportunity closes and the Won/Lost forms go away), the effect never runs.
- **Expected:** "Approved" / "Marked won" toast. **Actual:** no feedback beyond the item disappearing (and with B1, sometimes not even that).
- **Fix suggestion:** lift the toast to the caller (`onSuccess`), or show it before the refresh.
- **Tests:** `team.spec.ts` › "approving confirms with a toast", `pipeline.spec.ts` › "marking won confirms with a toast" (fixme).

<a id="b5"></a>
### B5 — Today, Accounts, Contacts and Properties have no `<h1>`
- **Where:** `src/components/today/today-view.tsx` (no PageHeader); `accounts-list-view.tsx:30`, `contacts-list-view.tsx:27` and `properties-list-view.tsx:52` start with `BookTabs`. Every other screen has exactly one h1.
- **Impact:** screen-reader users have nothing to navigate by on the four most-used screens.
- **Fix suggestion:** add an `sr-only` `<h1>` ("Today", "Accounts", …) or a visible `PageHeader`.
- **Tests:** `a11y.spec.ts` › `<screen>` › "exactly one h1" (4 fixme × 2 projects).
- **Screenshot:** `tests/e2e/bug-shots/b5-today-no-h1.png`

<a id="b6"></a>
### B6 — Records from another company (or bad ids) return HTTP 200 (soft 404)
- **Where:** `notFound()` in `src/app/app/accounts/[id]/page.tsx` (and contacts/properties/pipeline) renders `src/app/app/not-found.tsx` inside the streamed shell, so the status is 200.
- **Security:** fine. Colby and the TSG rep both get "Can't find that one." and no data leaks (tenancy specs pass). Only the status code is wrong, which matters for monitoring.
- **Fix suggestion:** resolve the record before any streaming (no `loading.tsx` above `[id]`), or accept 200 and drop the test.
- **Test:** `tenancy.spec.ts` › "another company's record answers with HTTP 404" (fixme).

<a id="b7"></a>
### B7 — Drop on a task that was never snoozed says "Snoozed 0 times."
- **Where:** `src/components/today/task-actions.tsx:28`. The Drop button reuses the over-snoozed panel.
- **Steps:** Today → any task → `Drop`. **Actual:** "Snoozed 0 times. Drop it, or take the account off the list?"
- **Fix suggestion:** show "Drop this, or take the account off the list?" when `snoozeCount < MAX_SNOOZES`.
- **Test:** `today.spec.ts` › "the Drop prompt doesn't claim the task was snoozed…" (fixme).
- **Screenshot:** `tests/e2e/bug-shots/b7-drop-snoozed-0-times.png`

<a id="b8"></a>
### B8 — Tapping Log while Supabase is unreachable sends the rep to the sign-in page
- **Where:** `loadLogContext` → `ctx()` → `getSession()` → `redirect("/login?offline=1")` (`src/lib/session.ts:38`) from inside a server action, so the whole page navigates away.
- **Expected:** the sheet's own message "Couldn't load. Check signal and try again." (`log-sheet.tsx`), with Today left in place.
- **Actual:** the rep lands on the Sign in page with the "Can't reach the server" notice. Recovery works ("Try again" link, session intact), but they lose their place.
- **Fix suggestion:** in server actions, throw or return an error instead of `redirect()` when auth is unreachable. Keep the redirect for page renders only.
- **Test:** `resilience.spec.ts` › "opening the Log sheet while Supabase is down…" (fixme).
- **Screenshot:** `tests/e2e/bug-shots/b8-log-sheet-supabase-down.png`

---

### Notes (not bugs)
- When Supabase is down, navigation goes to `/login?offline=1` with a "Can't reach the server … you're probably still signed in" notice and a Try again link. This is accepted as the designed behaviour, and the resilience spec checks that it recovers with no re-login.
- After an action, the page refresh can take a few seconds while three workers run in parallel. The expect timeout is 20 s for that reason.
