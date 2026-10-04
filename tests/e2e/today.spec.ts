import { db, fxAccount, fxContact, fxTask, tasksFor } from "./support/db";
import { as, expect, queueRow, settle, tap, test, toasts } from "./support/ui";

test.describe("Colby's Today (no brief today)", () => {
  as("colby");

  test("works without a Daily Brief and shows the queue sections", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page.getByRole("region", { name: "Daily brief" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Today's progress" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Overdue · \d+/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Due today · \d+/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Re-engage · \d+/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^First touches · \d+/ })).toBeVisible();
    await expect(page.getByText("Re-engage Asset Living")).toBeVisible();
    await expect(page.getByText("First touch: Pinnacle Property Management")).toBeVisible();
    await expect(page.getByRole("region", { name: "Leaderboard this week" })).toBeVisible();
    // Streak seeded: three cleared weekdays.
    await expect(page.getByRole("region", { name: "Today's progress" })).toContainText(/Streak\s*3\s*cleared weekdays/);
  });

  test("overdue items say how late they are", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Send W-9 to ${acct.name}`, kind: "custom", due: -5, createdDaysAgo: 8 });
    await page.goto("/app/today");
    const row = queueRow(page, t.title);
    await expect(row.getByText("5 days late")).toBeVisible();
    const overdue = page.getByRole("region", { name: /^Overdue/ });
    await expect(overdue.getByText(t.title)).toBeVisible();
  });

  test("Done closes a task", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Done-me ${acct.name}`, kind: "custom", due: 0 });
    await page.goto("/app/today");
    await tap(page, queueRow(page, t.title).getByRole("button", { name: "Done" }));
    await expect(toasts(page)).toContainText("Done — off the list");
    await settle(page);
    await expect(page.getByText(t.title, { exact: true })).toHaveCount(0);
    expect((await tasksFor({ accountId: acct.id }))[0]?.status).toBe("done");
  });

  test("Snooze moves a task to the next business day", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Snooze-me ${acct.name}`, kind: "custom", due: 0 });
    await page.goto("/app/today");
    await tap(page, queueRow(page, t.title).getByRole("button", { name: "Snooze" }));
    await expect(toasts(page)).toContainText(/Snoozed to (Tomorrow|Mon|Tue|Wed|Thu|Fri)/);
    await settle(page);
    await expect(page.getByText(t.title, { exact: true })).toHaveCount(0);
    const { data } = await db.from("task").select("snooze_count,status").eq("id", t.id).single();
    expect(data).toMatchObject({ snooze_count: 1, status: "open" });
  });

  test("Drop removes a task (with the drop / not-pursuing choice)", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Drop-me ${acct.name}`, kind: "custom", due: 0 });
    await page.goto("/app/today");
    const row = queueRow(page, t.title);
    await tap(page, row.getByRole("button", { name: "Drop" }));
    await expect(row.getByRole("button", { name: "Keep" })).toBeVisible();
    await tap(page, row.getByRole("button", { name: "Drop", exact: true }));
    await expect(toasts(page)).toContainText("Dropped");
    await settle(page);
    await expect(page.getByText(t.title, { exact: true })).toHaveCount(0);
    const { data } = await db.from("task").select("status").eq("id", t.id).single();
    expect(data?.status).toBe("dropped");
  });

  // Known bug: BUGS.md#b7
  test.fixme("the Drop prompt doesn't claim the task was snoozed when it never was", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Drop-copy ${acct.name}`, kind: "custom", due: 0 });
    await page.goto("/app/today");
    const row = queueRow(page, t.title);
    await tap(page, row.getByRole("button", { name: "Drop" }));
    await expect(row.getByText(/Snoozed 0 times/)).toHaveCount(0);
  });

  test("call and email shortcuts are real tel:/mailto: links", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const p = await fxContact({ accountId: acct.id, phone: "(512) 555-0142", email: "ops@example.com" });
    const t = await fxTask({ accountId: acct.id, contactId: p.id, title: `Call ${p.full_name} re: bid`, due: 0 });
    await page.goto("/app/today");
    const row = queueRow(page, t.title);
    await expect(row.getByRole("link", { name: `Call ${p.full_name}`, exact: true })).toHaveAttribute("href", "tel:(512) 555-0142");
    await expect(row.getByRole("link", { name: `Email ${p.full_name}`, exact: true })).toHaveAttribute("href", "mailto:ops@example.com");
  });
});

test.describe("Kayla's Today (with a brief)", () => {
  as("kayla");

  test("the Daily Brief card renders its headline and lines", async ({ page }) => {
    await page.goto("/app/today");
    const brief = page.getByRole("region", { name: "Daily brief" });
    await expect(brief).toContainText("Cortland's $310K re-roof decision is this week");
    await expect(brief.getByText("Lock the Cortland proposal review before Thursday.")).toBeVisible();
    await expect(brief.getByText("Focus")).toBeVisible();
  });
});
