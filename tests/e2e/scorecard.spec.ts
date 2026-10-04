/** 90-day scorecard on Team (runs on mobile and desktop). */
import { as, expect, test, toasts } from "./support/ui";

test.describe("Tyler (manager)", () => {
  as("tyler");

  test("Team home card links to the scorecard; it renders numbers, sparklines and the per-rep table", async ({ page }) => {
    await page.goto("/app/team");
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "90-day scorecard" }) });
    await expect(card).toBeVisible();
    expect((await card.locator(".text-4xl").textContent())?.trim()).toMatch(/^\d+/);
    await card.getByRole("link").first().click();
    await page.waitForURL("**/app/team/scorecard");
    await expect(page.getByRole("heading", { level: 1, name: "90-day scorecard" })).toBeVisible();
    for (const h of ["Qualified meetings", "Onboarding paperwork", "In-person activity", "First touches", "Follow-up completion"]) {
      const m = page.locator("section").filter({ has: page.getByRole("heading", { name: h }) });
      await expect(m.locator(".text-4xl")).toHaveText(/^(\d[\d,]*%?|—)$/);
      await expect(m.getByRole("img", { name: new RegExp(`^${h}, last 13 weeks`) })).toBeVisible();
    }
    // The seed logs in-person touches for Kayla this week, so the team's in-person count is non-zero.
    const inPerson = page.locator("section").filter({ has: page.getByRole("heading", { name: "In-person activity" }) });
    expect(Number((await inPerson.locator(".text-4xl").textContent())?.replace(/,/g, ""))).toBeGreaterThan(0);
    await expect(page.getByText(/Touches booking an inspection or meeting a decision maker/)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Kayla Smiley" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Company" })).toBeVisible();
    // Managers see targets but don't edit them.
    await expect(page.getByRole("button", { name: "Save targets" })).toHaveCount(0);
  });
});

test.describe("Parks (TSG owner)", () => {
  as("team");
  test("owner sets a meetings target; it shows as the goal", async ({ page }) => {
    await page.goto("/app/team/scorecard");
    await page.getByLabel("Meetings / month").fill("24");
    await page.getByRole("button", { name: "Save targets" }).click();
    await expect(toasts(page)).toContainText("Targets saved");
    const m = page.locator("section").filter({ has: page.getByRole("heading", { name: "Qualified meetings" }) });
    await expect(m).toContainText("of 24 goal");
    await expect(m).toContainText(/goal ≈ 5\.5\/wk/);
  });
});
