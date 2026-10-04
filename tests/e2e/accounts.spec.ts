import { db, eventually, fxAccount, pointsFor, uniqueWord } from "./support/db";
import { as, expect, formAlert, tap, test, toasts } from "./support/ui";

as("colby");

test("search finds an account by name", async ({ page }) => {
  await page.goto("/app/accounts?scope=all");
  await page.getByRole("searchbox", { name: "Search accounts" }).fill("greystar");
  await page.getByRole("searchbox", { name: "Search accounts" }).press("Enter");
  await expect(page).toHaveURL(/q=greystar/);
  const rows = page.locator("main ul li");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Greystar");
});

test("filters: type = General contractor, state chips, mine vs everyone's", async ({ page }) => {
  await page.goto("/app/accounts?scope=all");
  await page.getByRole("combobox", { name: "Account type" }).selectOption("gc");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await expect(page).toHaveURL(/type=gc/);
  const rows = page.locator("main ul li");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "General contractor" })).toHaveCount(2);

  await page.goto("/app/accounts?scope=all");
  await page.getByRole("group", { name: "Whose accounts" }).getByRole("link", { name: "Not started" }).click();
  await expect(page).toHaveURL(/state=not_started/);
  await expect(page.locator("main ul li").first()).toContainText("Not started");
  await expect(page.locator("main ul li").filter({ hasText: "Active" })).toHaveCount(0);

  await page.getByRole("group", { name: "Whose accounts" }).getByRole("link", { name: "My accounts" }).click();
  await expect(page).toHaveURL(/scope=mine/);
  await expect(page.getByText("Trammell Crow Residential")).toHaveCount(0); // unassigned
});

test("creating an account with an existing name warns instead of duplicating", async ({ page }) => {
  await page.goto("/app/accounts/new");
  await page.getByLabel(/Company name/).fill("Greystar");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(formAlert(page)).toContainText("“Greystar” already exists");
  await expect(page).toHaveURL(/\/app\/accounts\/new$/);
  const { count } = await db.from("account").select("id", { count: "exact", head: true }).eq("name", "Greystar");
  expect(count).toBe(1);
});

test("create a new account, then edit it", async ({ page }) => {
  const name = `${uniqueWord()} Residential`;
  await page.goto("/app/accounts/new");
  await page.getByLabel(/Company name/).fill(name);
  await page.getByLabel("Type").selectOption({ label: "Property mgmt" });
  await page.getByLabel("Priority").selectOption({ label: "P1" });
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("Main phone").fill("(512) 555-0177");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/app\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Owner: Colby Remedios")).toBeVisible();
  await expect(page.getByRole("link", { name: "Call main line" })).toHaveAttribute("href", "tel:(512) 555-0177");

  await page.getByRole("link", { name: "Edit account" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit account" })).toBeVisible();
  await page.getByLabel("City").fill("Round Rock");
  await page.getByLabel("Office address").fill("201 E Main St");
  await page.getByRole("button", { name: "Save account" }).click();
  await page.waitForURL(/\/app\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.getByText("201 E Main St, Round Rock")).toBeVisible();
});

test("Do not pursue: the account shows why and leaves Today's queue", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby", tier: 1, name: `${uniqueWord()} Apartments` });
  await page.goto("/app/today");
  await expect(page.getByText(`First touch: ${acct.name}`)).toBeVisible();

  await page.goto(`/app/accounts/${acct.id}`);
  await tap(page, page.getByText("Do not pursue", { exact: true }));
  await page.getByLabel(/Reason/).fill("Uses in-house crew");
  await tap(page, page.getByRole("button", { name: "Save · Do not pursue" }));
  // ActionForm saves can leave the UI stuck on "Saving…" (BUGS.md#b1): assert the save, then reload.
  await eventually(async () => (await db.from("account_preference").select("preference").eq("account_id", acct.id)).data ?? [], (r) => r.length === 1);
  await page.reload();
  await expect(page.getByText("Off the list — Uses in-house crew")).toBeVisible();

  await page.goto("/app/today");
  await expect(page.getByText(`First touch: ${acct.name}`)).toHaveCount(0);
  // Still findable in the book, sunk with the reason.
  await page.goto(`/app/accounts?scope=all&state=excluded&q=${encodeURIComponent(acct.name)}`);
  await expect(page.getByText("Off the list — Uses in-house crew")).toBeVisible();
});

test("Do not pursue requires a reason", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  await page.goto(`/app/accounts/${acct.id}`);
  await tap(page, page.getByText("Competitor", { exact: true }));
  await tap(page, page.getByRole("button", { name: "Save · Competitor" }));
  // Browser-required field blocks the submit; nothing saved.
  await expect(page.getByLabel(/Reason/)).toHaveJSProperty("validity.valueMissing", true);
  const { data } = await db.from("account_preference").select("preference").eq("account_id", acct.id);
  expect(data).toHaveLength(0);
});

test("onboarding stepper: advancing to a paperwork step saves and awards points", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  await page.goto(`/app/accounts/${acct.id}`);
  const steps = page.getByRole("list", { name: "Onboarding steps" });
  await expect(steps.getByRole("button", { name: "Not started" })).toHaveAttribute("aria-current", "step");
  await tap(page, steps.getByRole("button", { name: "Paperwork started" }));
  await expect(toasts(page)).toContainText("Onboarding: Paperwork started · +15");
  await expect(steps.getByRole("button", { name: "Paperwork started" })).toHaveAttribute("aria-current", "step");
  const pts = await eventually(() => pointsFor("colby", { accountId: acct.id, event: "onboarding_step" }), (p) => p.length === 1);
  expect(pts[0]!.points).toBe(15);
  await page.reload();
  await expect(page.getByText("Paperwork started").first()).toBeVisible();
});

test("account detail: people grouped by role, properties, opportunities and timeline", async ({ page }) => {
  const { data: g } = await db.from("account").select("id").eq("name", "Greystar").single();
  await page.goto(`/app/accounts/${g!.id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Greystar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^People · \d+/ })).toBeVisible();
  await expect(page.getByText("Decision maker", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /^Dana Whitfield/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Properties · [1-9]/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Open opportunities/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log touch with Dana Whitfield" })).toBeVisible();
});
