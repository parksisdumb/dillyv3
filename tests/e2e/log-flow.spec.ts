/**
 * THE core loop: from Today, log a touch in ≤3 taps; the follow-up engine closes the open follow-up and schedules the
 * next one (Dilly V2's #1 failure was follow-ups that never closed).
 */
import { dayOffset, eventually, fxAccount, fxContact, fxTask, tasksFor, touchesForAccount, touchesForContact } from "./support/db";
import { as, expect, queueRow, settle, sheet, tap, test, tile, toasts } from "./support/ui";

as("colby");

/** A Colby-owned account + decision maker + an open follow-up due today (scheduled two days ago). */
async function followUpFixture(opts: { due?: number } = {}) {
  const acct = await fxAccount({ owner: "colby", tier: 2 });
  const person = await fxContact({ accountId: acct.id, persona: "economic_buyer", title: "Regional VP" });
  const task = await fxTask({ accountId: acct.id, contactId: person.id, title: `Follow up with ${person.full_name}`, due: opts.due ?? 0, createdDaysAgo: 2 });
  return { acct, person, task };
}

test("Today → Log → Site visit → Met decision maker: logged in 2 taps, follow-up auto-closed, timeline updated", async ({ page }) => {
  const { acct, person, task } = await followUpFixture();
  await page.goto("/app/today");
  const row = queueRow(page, task.title);
  await expect(row).toBeVisible();

  // Open the sheet from the queue item: contact is pre-selected.
  await tap(page, row.getByRole("button", { name: "Log", exact: true }));
  const s = sheet(page);
  await expect(s.getByRole("button", { name: new RegExp(`^${person.full_name}`) })).toBeVisible();

  // Tap 1: channel. Tap 2: outcome (the outcome tap logs).
  let taps = 0;
  await tap(page, tile(s, "Site visit"));
  taps++;
  await tap(page, tile(s, "Met decision maker"));
  taps++;
  expect(taps).toBeLessThanOrEqual(3);

  // Toast: points + closed follow-up + next follow-up with a day label.
  // decision maker: touch 1 + connect 3 + DM 6 + on-time follow-up 3 = +13
  await expect(toasts(page)).toContainText(/\+13 · follow-up closed · next: Next step with .+ (Mon|Tue|Wed|Thu|Fri|Tomorrow|[A-Z][a-z]{2} \d+)/);
  await expect(s).toHaveCount(0);

  // The previous open follow-up is gone from Today (auto-close), without a manual Done.
  await settle(page);
  await expect(page.getByText(task.title, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(task.title, { exact: true })).toHaveCount(0);

  const tasks = await tasksFor({ contactId: person.id });
  expect(tasks.find((t) => t.id === task.id)?.status).toBe("done");
  const next = tasks.filter((t) => t.status === "open");
  expect(next).toHaveLength(1);
  expect(next[0]!.title).toMatch(/^Next step with /);

  // The touch is on the account timeline.
  await page.goto(`/app/accounts/${acct.id}`);
  const timeline = page.locator("ol").filter({ hasText: "Site visit" });
  await expect(timeline.getByText("Met decision maker")).toBeVisible();
  await expect(timeline.getByText(person.full_name)).toBeVisible();
});

test("double-tapping an outcome logs exactly one touch", async ({ page }) => {
  const { person, task } = await followUpFixture();
  await page.goto("/app/today");
  await tap(page, queueRow(page, task.title).getByRole("button", { name: "Log", exact: true }));
  const s = sheet(page);
  await tap(page, tile(s, "Call"));
  await tile(s, "Connected").dblclick();
  await expect(toasts(page)).toContainText(/follow-up closed/);
  await page.waitForTimeout(1500);
  const touches = await touchesForContact(person.id);
  expect(touches).toHaveLength(1);
});

test("'No follow-up' logs without scheduling anything", async ({ page }) => {
  const { person, task } = await followUpFixture();
  await page.goto("/app/today");
  await tap(page, queueRow(page, task.title).getByRole("button", { name: "Log", exact: true }));
  const s = sheet(page);
  await tap(page, tile(s, "Call"));
  await tap(page, s.getByRole("button", { name: /Notes, who I met, follow-up/ }));
  await s.getByLabel("No follow-up").check();
  await expect(s.getByLabel("Follow up on")).toBeDisabled();
  await tap(page, tile(s, "Connected"));
  await expect(toasts(page)).toContainText(/follow-up closed · no follow-up set/);

  const [touch] = await eventually(() => touchesForContact(person.id), (t) => t.length === 1);
  expect(touch!.skip_follow_up).toBe(true);
  const open = (await tasksFor({ contactId: person.id })).filter((t) => t.status === "open");
  expect(open).toHaveLength(0);
});

test("a custom follow-up date is used for the next task", async ({ page }) => {
  const { person, task } = await followUpFixture();
  const when = dayOffset(9);
  await page.goto("/app/today");
  await tap(page, queueRow(page, task.title).getByRole("button", { name: "Log", exact: true }));
  const s = sheet(page);
  await tap(page, tile(s, "Email"));
  await tap(page, s.getByRole("button", { name: /Notes, who I met, follow-up/ }));
  await s.getByLabel("Follow up on").fill(when);
  await s.getByLabel("Notes").fill("Sent the maintenance program PDF");
  await tap(page, tile(s, "Sent"));
  const [y, m, d] = when.split("-").map(Number);
  const label = new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  await expect(toasts(page)).toContainText(`next: Follow up on email to ${person.full_name} ${label}`);

  const open = await eventually(
    async () => (await tasksFor({ contactId: person.id })).filter((t) => t.status === "open"),
    (t) => t.length === 1,
  );
  expect(open[0]!.due_on).toBe(when);
});

test("account-level log with no contact: gatekeeper creates an account-level 'find another way in' task", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby", tier: 2 });
  await fxContact({ accountId: acct.id, persona: "initiator" });
  await page.goto(`/app/accounts/${acct.id}`);
  await tap(page, page.getByRole("button", { name: "Log on this account" }));
  const s = sheet(page);
  // The sheet pre-picks a person; switch to "no contact".
  await tap(page, s.getByRole("button", { name: /Change$/ }));
  await tap(page, s.getByRole("button", { name: "No contact — log on the account" }));
  await expect(s.getByText(`${acct.name} (no contact)`)).toBeVisible();
  await tap(page, tile(s, "Door knock"));
  await tap(page, tile(s, "Gatekeeper"));
  await expect(toasts(page)).toContainText(`next: Find another way into ${acct.name}`);

  const touches = await eventually(() => touchesForAccount(acct.id), (t) => t.length === 1);
  expect(touches[0]!.contact_id).toBeNull();
  const open = (await tasksFor({ accountId: acct.id })).filter((t) => t.status === "open");
  expect(open).toHaveLength(1);
  expect(open[0]).toMatchObject({ kind: "try_other_contact", contact_id: null });

  await page.reload();
  await expect(page.getByText(`Find another way into ${acct.name}`)).toBeVisible();
});

test("Log button with no context: pick a person by search, then log", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const person = await fxContact({ accountId: acct.id });
  await page.goto("/app/today");
  await tap(page, page.getByRole("button", { name: "Log a touch" }));
  const s = sheet(page);
  await s.getByPlaceholder("Search people or accounts").fill(person.full_name.split(" ")[1]!);
  await tap(page, s.getByRole("button", { name: new RegExp(person.full_name) }));
  await expect(s.getByRole("button", { name: new RegExp(`^${person.full_name}`) })).toBeVisible();
  await expect(s.locator("#log-sheet-title")).toHaveText(acct.name);
  await tap(page, tile(s, "Call"));
  await tap(page, tile(s, "Left voicemail"));
  await expect(toasts(page)).toContainText(/next: Call .+ back/);
});

test("Log button with no context offers recent people: one tap picks the person", async ({ page }) => {
  const { person, task } = await followUpFixture();
  await page.goto("/app/today");
  await tap(page, queueRow(page, task.title).getByRole("button", { name: "Log", exact: true }));
  await tap(page, tile(sheet(page), "Call"));
  await tap(page, tile(sheet(page), "Connected"));
  await expect(toasts(page)).toContainText(/follow-up closed/);
  await expect(sheet(page)).toHaveCount(0);

  await tap(page, page.getByRole("button", { name: "Log a touch" }));
  const s = sheet(page);
  await expect(s.getByText("Recent", { exact: true })).toBeVisible();
  await tap(page, s.getByRole("button", { name: new RegExp(`^${person.full_name}`) }));
  await expect(s.getByRole("button", { name: /Change$/ })).toContainText(person.full_name);
  await tap(page, tile(s, "Text"));
  await tap(page, tile(s, "Sent"));
  await expect(toasts(page)).toContainText(/next: Follow up on email to|next: /);
});
