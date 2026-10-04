# Property Manager Portal — handoff spec

**Status:** spec, not started. Start after Dilly is live and stable (target week of Oct 12, 2026). ~1 week build + test.
**Decision (Oct 4, 2026):** same codebase and database as Dilly, separate front door. Not a separate app.

## 1. Why same database, separate surface

| Question | Answer |
|---|---|
| Where does the data live? | Already in Dilly: `property`, roof facts, `property_flag` badges, `property_party` ownership/management history, touches with photos, opportunities, tasks. A separate app would copy it and drift. |
| Who sees what? | Access follows `property_party`: a PM user sees properties where their account is the **current** manager (or owner). When management changes in Dilly, the old PM loses access and the new PM gains it automatically. |
| Why a separate surface? | External audience: own domain + tenant branding, email-link sign-in only, read-mostly screens, zero internal data (rep notes, scores, points, preferences, competitor flags, margins). |

## 2. Users and access

- New role table `portal_user (id, tenant_id, account_id, email, full_name, title, role 'viewer'|'requester'|'approver', invited_by, last_seen_at, disabled_at)`. Not a `membership` — portal users are never tenant members, so every existing internal RLS policy stays closed to them by construction.
- Auth: Supabase magic link only. A portal session carries a claim `portal=true` (custom access-token hook) so internal routes reject it.
- RLS: portal policies on a small set of **views** (`portal_property`, `portal_inspection`, `portal_request`, `portal_proposal`, `portal_invoice`, `portal_capex_line`) filtered by `account_id in (current parties of the user's account)`. No portal policy on base tables.
- Invite flow: from account detail in Dilly ("Invite to portal" → email, role). Contacts at the account are suggested. Access revoked automatically when their account stops being a current party on every property, and manually from account detail.
- Approver role required to approve proposals; requester can submit service requests; viewer read-only.

## 3. Branding and domains

- `portal.<tenant domain>` (e.g. portal.thesvcgroup.com, portal.foxroofing.co) mapped in Vercel to the same deployment; middleware resolves tenant by host.
- `tenant.settings.portal`: logo, accent color, support phone/email, emergency line, legal footer. The PM never sees "Dilly".

## 4. Screens (mobile-first; property managers also live on phones)

1. **My properties** — cards with name, address, badges (leak, ponding, hail, warranty, roof age), last visit, open items count. Filter by city. Portfolio summary at top: properties, open requests, proposals awaiting approval, roofs 15+ years.
2. **Property** — roof facts (system, age, area, warranty, buildings), condition flags with dates, photo timeline from visits (only photos marked shareable), inspection reports, requests, proposals, invoices, cap-ex lines.
3. **Request service** (≤ 30 seconds): property → issue type (active leak, ponding, damage after storm, other) → where (building/unit, optional) → photos → urgency → submit. Creates in Dilly: `service_request` row, `property_flag active_leak` when relevant (droplet badge everywhere), a high-priority task for the account owner (boost so it tops Today), a push to the assigned rep and the tenant's dispatch contact, and a G1-free automatic acknowledgment email/SMS to the requester with a status link. Status steps: Received → Scheduled → On site → Done (with photos) → Invoiced.
4. **Inspection reports** — generated from Dilly inspection/roof-walk touches: findings, photos with captions, recommended repairs with priority and price (TSG cost-plus: labor + material + margin shown per their transparency model; FOX: line-item price). PDF download and share link.
5. **Proposals** — view options (good/better/best), approve one with e-sign (Dropbox Sign, already in the stack plan), or request changes. Approval moves the opportunity to won and notifies the rep; changes create a task.
6. **Invoices** — v1: PDF upload from Dilly by the office (and status paid/unpaid). v2: sync from QuickBooks Online / the finance module (`invoice`, `pay_app` tables from the Pod 6 spec). Gate G9 applies before anything financial is visible to a customer.
7. **Cap-ex plan** — per property and portfolio, years 1–10: projected repair spend, maintenance program cost, and replacement year/cost by roof section. Built from roof system + install year + area + condition flags + inspection findings using a tenant-editable assumptions table (service life by system, $/sf by system and market, annual repair curve by age). PM can download for budget season (Q4) and mark lines "Budgeted for 2027" — which becomes a high-intent signal in Dilly (task for the rep, opportunity created at "lead").
8. **Documents** — COIs, W-9, warranties, NDL certificates, manufacturer inspection letters; the PM can download what their vendor portal asks for (ties to the onboarding ladder).

## 5. New data (additive migrations)

| Table | Purpose |
|---|---|
| `portal_user` | External users and roles |
| `service_request` | id, tenant_id, property_id, account_id, requester (portal_user), issue_type, location_note, urgency, status, photos jsonb, created_at, scheduled_for, completed_at, task_id, opportunity_id |
| `report` | Rendered inspection reports (source touch ids, findings jsonb, pdf path, shared_at) |
| `capex_assumption` | Tenant-level service life and $/sf by system/market |
| `capex_line` | property_id, section, year, kind (repair/maintenance/replacement), amount, basis jsonb, budgeted_by_pm, budget_year |
| `document` | (from the Pod 5 spec) with `portal_visible` flag |
| `media.shareable` | flag on photos so nothing internal leaks |

## 6. What Dilly gains (why it's a sales weapon)

- Service requests arrive with photos and land at the top of the rep's queue — fastest response in the market.
- Every portal login is a touch (`channel 'portal'`); proposal views are buying signals; "budgeted" cap-ex lines are the best lead source a roofing company can have.
- Switching cost: a PM who submits leaks and plans budgets in your portal does not take a competitor's call.
- Management changes: the new PM gets an invite as part of the intro task ("we already have this building's history — here's your portal").

## 7. Build order

1. portal_user + auth hook + host-based tenant resolution + RLS views + invite flow (2 days)
2. My properties + Property + Request service end to end with notifications (2 days)
3. Inspection report rendering + PDF (1 day)
4. Proposals approve/e-sign (1 day; Dropbox Sign account needed)
5. Cap-ex plan v1 with assumptions table (1–2 days)
6. Invoices as PDFs + documents (½ day)
7. E2E: a PM sees only current-party properties; transfer revokes access; request creates task + badge + push; approval moves opp; no internal field ever renders (snapshot test on every portal view's columns).

## 8. Open decisions for Parks

1. Portal domains per tenant (need DNS access for thesvcgroup.com and foxroofing.co).
2. Show prices on inspection reports for FOX, or only on proposals?
3. Who receives service-request alerts at each tenant after hours (TSG's staged 24/7 promise)?
4. E-sign provider: Dropbox Sign (planned) vs DocuSign if a client requires it.
5. Invoice source for v2: QuickBooks Online for both tenants?
