import { E2E_PASSWORD } from "../../scripts/e2e/seed";
import { db } from "./support/db";
import { expect, formAlert, test } from "./support/ui";

// Fresh, signed-out browser for every test here (no storageState).

async function signIn(page: import("@playwright/test").Page, email: string, password = E2E_PASSWORD) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test.describe("Sign in / sign out", () => {
  test("a rep signs in with email + password and lands on Today", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await signIn(page, "colby@foxroofing.co");
    await page.waitForURL("**/app/today");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByText("FOX Roofing").first()).toBeVisible();
  });

  test("a wrong password shows a plain message and stays on the login page", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, "colby@foxroofing.co", "not-the-password");
    await expect(formAlert(page)).toHaveText("Wrong email or password.");
    await expect(page).toHaveURL(/\/login/);
    // The email the rep typed is still there (no retyping on a phone).
    await expect(page.getByLabel("Email")).toHaveValue("colby@foxroofing.co");
  });

  test("an invited rep's first sign-in claims the invite and lands in FOX", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, "ben@foxroofing.co");
    await page.waitForURL("**/app/today");
    await expect(page.getByText("FOX Roofing").first()).toBeVisible();
    const { data } = await db.from("invite").select("claimed_at").eq("email", "ben@foxroofing.co").single();
    expect(data?.claimed_at).not.toBeNull();
  });

  test("sign out from the profile menu returns to /login and /app is closed again", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, "dylan@foxroofing.co");
    await page.waitForURL("**/app/today");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login");
    await page.goto("/app/accounts");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Faccounts/);
  });
});

test.describe("Redirects", () => {
  test("signed-out visits to any /app screen bounce to /login with next=", async ({ page }) => {
    for (const p of ["/app/today", "/app/pipeline", "/app/team", "/app/accounts/00000000-0000-0000-0000-000000000000"]) {
      await page.goto(p);
      await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(p).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    }
  });

  test("after signing in, the rep is sent to the page they asked for (next=)", async ({ page }) => {
    await page.goto("/app/pipeline");
    await expect(page).toHaveURL(/\/login\?next=/);
    await signIn(page, "colby@foxroofing.co");
    await page.waitForURL("**/app/pipeline");
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  });

  test("open-redirect attempts stay on-site", async ({ page }) => {
    for (const evil of ["https://evil.com", "//evil.com", "/\\evil.com"]) {
      await page.context().clearCookies();
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      await signIn(page, "colby@foxroofing.co");
      await page.waitForLoadState("load");
      await expect(page).toHaveURL(/^http:\/\/localhost:\d+\//);
      expect(new URL(page.url()).hostname).toBe("localhost");
    }
  });

  test("an already signed-in user visiting /login?next=https://evil.com stays on-site", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, "colby@foxroofing.co");
    await page.waitForURL("**/app/today");
    await page.goto("/login?next=https%3A%2F%2Fevil.com");
    expect(new URL(page.url()).hostname).toBe("localhost");
    await expect(page).toHaveURL(/\/app\/today/);
  });
});
