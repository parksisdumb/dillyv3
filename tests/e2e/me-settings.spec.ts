import { db, eventually } from "./support/db";
import { as, expect, test, toasts } from "./support/ui";

test.describe("Colby (rep)", () => {
  as("colby");

  test("Me shows points, streak and badges", async ({ page }) => {
    await page.goto("/app/me");
    await expect(page.getByRole("heading", { level: 1, name: "Colby Remedios" })).toBeVisible();
    await expect(page.getByText("FOX Roofing · rep")).toBeVisible();
    const week = page.getByText("This week", { exact: true }).locator("..");
    expect(Number((await week.locator(".text-2xl").textContent())?.trim())).toBeGreaterThan(0);
    await expect(page.getByText("Streak", { exact: true }).locator("..")).toContainText("3");
    await expect(page.getByRole("heading", { name: "Badges" })).toBeVisible();
    await expect(page.locator("main ul li").filter({ has: page.locator("svg") }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Recent points · \d+ all time/ })).toBeVisible();
    await expect(page.getByText("Logged touch").first()).toBeVisible();
  });

  test("the bottom nav shows Me (not Team) for a rep", async ({ page }) => {
    await page.goto("/app/today");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Me" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);
  });

  test("Settings: a rep edits their profile but sees no targeting editor or invites", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Targeting/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save targeting row" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Invites" })).toHaveCount(0);
  });

  // Known bug: BUGS.md#b2 — RLS "infinite recursion detected in policy for relation profile".
  test.fixme("Settings: saving my profile (mobile number) works", async ({ page }) => {
    await page.goto("/app/settings");
    await page.getByLabel("Mobile").fill("(512) 555-0110");
    await page.getByRole("button", { name: "Save profile" }).click();
    await expect(toasts(page)).toContainText("Profile saved");
    await expect(page.locator("p[role=alert]")).toHaveCount(0);
  });
});

test.describe("Tyler (manager)", () => {
  as("tyler");

  test("Settings: the targeting editor and invites are visible to a manager", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Targeting — what FOX Roofing pursues" })).toBeVisible();
    await expect(page.locator("main li").filter({ hasText: "property mgmt" }).getByText("× 1.20")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save targeting row" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Invites" })).toBeVisible();
    await expect(page.locator("main li").filter({ hasText: "ben@foxroofing.co" })).toBeVisible();
    // Managers can't hand out owner/admin.
    const roles = await page.getByLabel("Role").locator("option").allTextContents();
    expect(roles).not.toContain("Owner");
    expect(roles).not.toContain("Admin");
    // Team goal is owner/admin only.
    await expect(page.getByRole("heading", { name: "Team goal (monthly)" })).toHaveCount(0);
  });

  test("Me is reachable from the profile menu", async ({ page }) => {
    await page.goto("/app/today");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("link", { name: "My points & badges" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Tyler Fox" })).toBeVisible();
  });
});

test.describe("Parks (admin)", () => {
  as("parks");

  test("an admin sets a monthly team goal and it shows on Today", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Team goal (monthly)" })).toBeVisible();
    await page.getByLabel(/^Label/).fill("Inspections booked");
    await page.getByLabel(/^Target/).fill("20");
    await page.getByRole("button", { name: /Set goal|Update goal/ }).click();
    await eventually(async () => (await db.from("tenant").select("settings").eq("slug", "fox").single()).data?.settings as Record<string, unknown>, (s) => !!s?.team_goal);
    await page.goto("/app/today");
    await expect(page.getByRole("region", { name: "Team goal" })).toContainText(/Inspections booked\s*\d+\/20/);
  });
});
