// Gmail sync UI when the server has no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / MAIL_TOKEN_KEY (the e2e app env):
// admins see why the Email section is empty; reps see nothing (no card, no Today prompt).
import { as, expect, test } from "./support/ui";

test.describe("Parks (admin)", () => {
  as("parks");

  test("Settings shows 'Email sync isn't configured yet' to an admin", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const card = page.locator("section#email");
    await expect(card.getByRole("heading", { name: "Email sync" })).toBeVisible();
    await expect(card.getByText("Email sync isn't configured yet")).toBeVisible();
    await expect(page.getByRole("link", { name: /Continue with Google/ })).toHaveCount(0);
  });
});

test.describe("Colby (rep)", () => {
  as("colby");

  test("a rep sees no Email section and no Today prompt while sync isn't configured", async ({ page }) => {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Email sync" })).toHaveCount(0);
    await expect(page.getByText("Email sync isn't configured yet")).toHaveCount(0);
    await page.goto("/app/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeAttached();
    await expect(page.getByRole("complementary", { name: "Connect your email" })).toHaveCount(0);
  });
});
