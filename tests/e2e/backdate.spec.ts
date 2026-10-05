/**
 * Post-dated touches ("When" in the Log sheet, "Log a past visit") and the Condo/HOA management account type.
 * Reps backfill up to 30 days (tenant.settings.backdate_days); managers have no limit. Backfilled touches say
 * "Logged later" on every timeline and in Team → Activity.
 */
import { chicagoToday, dayOffset, db, eventually, fxAccount, fxContact, tasksFor, tenantId, touchesForAccount, uniqueWord, userId } from "./support/db";
import { as, expect, formAlert, settle, sheet, tap, test, tile, toasts } from "./support/ui";

const chicagoDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(iso));

test.describe("a rep backfills", () => {
  as("colby");

  test("'Yesterday' site visit: the line says when, the timeline shows yesterday + Logged later", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby", tier: 2 });
    const person = await fxContact({ accountId: acct.id });
    await page.goto(`/app/accounts/${acct.id}`);
    await tap(page, page.getByRole("button", { name: "Log on this account" }));
    const s = sheet(page);
    await expect(s.getByRole("button", { name: new RegExp(`^${person.full_name}`) })).toBeVisible();
    await tap(page, tile(s, "Site visit"));
    await tap(page, s.getByRole("button", { name: /Notes, who I met, follow-up/ }));

    // Default is Now: no "Logging for" line.
    await expect(s.getByRole("button", { name: "Now", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(s.getByTestId("log-logging-for")).toHaveCount(0);

    await tap(page, s.getByRole("button", { name: "Yesterday", exact: true }));
    await s.getByLabel("Time yesterday").fill("10:00");
    const y = dayOffset(-1);
    const label = new Date(`${y}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).replace(",", "");
    await expect(s.getByTestId("log-logging-for")).toHaveText(new RegExp(`Logging for ${label}, 10:00 AM`));

    await tap(page, tile(s, "Met in person"));
    await expect(toasts(page)).toContainText(/\+\d+/);
    await expect(s).toHaveCount(0);

    const [t] = await eventually(() => touchesForAccount(acct.id), (r) => r.length === 1);
    const row = (await db.from("touch").select("occurred_at,created_at").eq("id", t!.id).single()).data!;
    expect(chicagoDay(row.occurred_at)).toBe(y);
    expect(Date.parse(row.created_at) - Date.parse(row.occurred_at)).toBeGreaterThan(3600_000);
    // The follow-up it scheduled is not already overdue.
    const open = (await tasksFor({ accountId: acct.id })).filter((k) => k.status === "open");
    for (const k of open) expect(k.due_on >= chicagoToday()).toBe(true);

    await settle(page);
    await page.reload();
    const item = page.locator("main ol li").filter({ hasText: "Met in person" });
    await expect(item.getByTestId("logged-later")).toBeVisible();
    await expect(item.locator("time")).toHaveText("Yesterday · 10:00 AM");
    await expect(item).toContainText(/Logged [A-Z][a-z]{2} [A-Z][a-z]{2} \d+, \d+:\d{2} (AM|PM)/);
  });

  test("can't pick 45 days ago — the sheet says why and nothing is logged", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby", tier: 2 });
    const person = await fxContact({ accountId: acct.id });
    await page.goto(`/app/contacts/${person.id}`);
    await tap(page, page.getByRole("button", { name: "Log a past visit" }));
    const s = sheet(page);
    // Opens on "Pick date & time", site visit pre-picked.
    await expect(s.getByRole("button", { name: "Pick date & time", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(s.getByText("Up to 30 days back.")).toBeVisible();
    await s.getByLabel("Date & time").fill(`${dayOffset(-45)}T10:00`);
    await tap(page, tile(s, "Met in person"));
    await expect(formAlert(s)).toHaveText("Reps can log up to 30 days back. Ask your manager to log anything older.");
    await expect(s).toBeVisible();
    await page.waitForTimeout(500);
    expect(await touchesForAccount(acct.id)).toHaveLength(0);
  });

  test("Now stays the default: an ordinary log has no Logged later chip", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby", tier: 2 });
    await fxContact({ accountId: acct.id });
    await page.goto(`/app/accounts/${acct.id}`);
    await tap(page, page.getByRole("button", { name: "Log on this account" }));
    const s = sheet(page);
    await tap(page, tile(s, "Call"));
    await tap(page, tile(s, "Connected"));
    await expect(s).toHaveCount(0);
    await settle(page);
    await page.reload();
    const item = page.locator("main ol li").filter({ hasText: "Connected" });
    await expect(item).toBeVisible();
    await expect(item.getByTestId("logged-later")).toHaveCount(0);
  });
});

test.describe("a manager backfills", () => {
  as("tyler");

  test("45 days ago is fine for a manager; Team → Activity shows it as Logged later", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby", tier: 2, name: `${uniqueWord()} Backfill Flats` });
    await fxContact({ accountId: acct.id });
    await page.goto(`/app/accounts/${acct.id}`);
    await tap(page, page.getByRole("button", { name: "Log a past visit" }));
    const s = sheet(page);
    await expect(s.getByText(/Up to \d+ days back/)).toHaveCount(0);
    const day = dayOffset(-45);
    await s.getByLabel("Date & time").fill(`${day}T10:00`);
    await expect(s.getByTestId("log-logging-for")).toContainText(", 10:00 AM");
    await tap(page, tile(s, "Met in person"));
    await expect(toasts(page)).toContainText(/\+\d+/);
    await expect(s).toHaveCount(0);

    const [t] = await eventually(() => touchesForAccount(acct.id), (r) => r.length === 1);
    const row = (await db.from("touch").select("occurred_at,user_id").eq("id", t!.id).single()).data!;
    expect(chicagoDay(row.occurred_at)).toBe(day);
    expect(row.user_id).toBe(await userId("tyler"));
    // Its follow-up is due today, not 40-odd days overdue.
    const open = (await tasksFor({ accountId: acct.id })).filter((k) => k.status === "open");
    expect(open.length).toBeGreaterThan(0);
    for (const k of open) expect(k.due_on).toBe(chicagoToday());

    await page.goto(`/app/team/activity?rep=${await userId("tyler")}&channel=site_visit`);
    const item = page.locator("main ol li").filter({ hasText: acct.name });
    await expect(item.getByTestId("logged-later")).toBeVisible();
    await expect(item).toContainText(/Logged /);
  });
});

test.describe("Condo/HOA management", () => {
  as("colby");

  test("create a Condo/HOA account and find it with the type filter", async ({ page }) => {
    const name = `${uniqueWord()} Owners Association`;
    await page.goto("/app/accounts/new");
    await page.getByLabel(/Company name/).fill(name);
    await page.getByLabel("Type").selectOption({ label: "Condo/HOA management" });
    await page.getByLabel("City").fill("Austin");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/app\/accounts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByText("Condo/HOA management").first()).toBeVisible();

    await page.goto(`/app/accounts?scope=all&q=${encodeURIComponent(name)}`);
    await page.getByRole("combobox", { name: "Account type" }).selectOption("condo_hoa_mgmt");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page).toHaveURL(/type=condo_hoa_mgmt/);
    const rows = page.locator("main ul li");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(name);
    await expect(rows.first()).toContainText("Condo/HOA management");

    // Other types filter it out.
    await page.goto(`/app/accounts?scope=all&q=${encodeURIComponent(name)}&type=property_mgmt`);
    await expect(page.getByText(`Nothing matches “${name}”`)).toBeVisible();
    await expect(page.locator("main ul li").filter({ hasText: name })).toHaveCount(0);
  });
});

test.describe("Condo/HOA import mapping", () => {
  as("parks");

  test("an HOA sheet maps the association column to Company and imports as Condo/HOA management", async ({ page }) => {
    const fox = await tenantId("fox");
    const w = uniqueWord(2);
    const a1 = `${w} Harbor HOA`;
    const a2 = `${w} Lakes COA`;
    const text = ["HOA\tCompany Type\tAddress\tCity\tState", `${a1}\tCommunity Association\t10 Harbor Way\tAustin\tTX`, `${a2}\t\t20 Lakes Dr\tAustin\tTX`].join("\n");
    try {
      await page.goto("/app/import");
      await page.getByRole("textbox", { name: "Pasted rows" }).fill(text);
      await page.getByRole("button", { name: "Use pasted rows" }).click();
      await expect(page.getByLabel("Import “HOA” as")).toHaveValue("account_name");
      await expect(page.getByLabel("Import “Company Type” as")).toHaveValue("account_type");
      await expect(page.getByLabel("Default company type")).toHaveValue("condo_hoa_mgmt");
      await page.getByLabel("New companies go to").selectOption({ label: "Unassigned" });
      await page.getByRole("button", { name: "Preview import" }).click();
      await page.getByRole("button", { name: /^Import \d+ rows$/ }).click();
      await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible({ timeout: 60_000 });
      const { data } = await db.from("account").select("name,account_type").eq("tenant_id", fox).in("name", [a1, a2]).order("name");
      expect(data).toEqual([
        { name: a1, account_type: "condo_hoa_mgmt" },
        { name: a2, account_type: "condo_hoa_mgmt" },
      ]);
    } finally {
      const { data } = await db.from("account").select("id,import_batch_id").eq("tenant_id", fox).in("name", [a1, a2]);
      const batches = [...new Set((data ?? []).map((r) => r.import_batch_id).filter((x): x is string => !!x))];
      for (const t of ["property_contact", "property", "contact", "account"] as const) {
        if (batches.length) await db.from(t).delete().eq("tenant_id", fox).in("import_batch_id", batches);
      }
      if (batches.length) await db.from("import_batch").delete().in("id", batches);
    }
  });
});
