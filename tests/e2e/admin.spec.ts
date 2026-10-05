/**
 * Admin: Parks (team@dillyos.com — TSG owner + platform admin) creates a login with a temporary password for a new
 * TSG rep, the rep is forced to pick their own password and lands in TSG; Parks changes their role and deactivates
 * them (access gone at once). Reps get a 404 on /app/admin; managers see Team read-only. Platform: add a company and
 * switch into it.
 */
import type { Page } from "@playwright/test";
import { db, eventually, uniqueWord } from "./support/db";
import { as, expect, newContext, test, toasts } from "./support/ui";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

function memberRow(page: Page, email: string) {
  return page.getByRole("list", { name: "Members" }).locator("li").filter({ hasText: email });
}

test.describe("Parks (TSG owner): logins, roles, access", () => {
  as("team");

  test("create a login → rep must change the temp password → lands in TSG; role change; deactivate → access gone", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const word = uniqueWord(2).toLowerCase();
    const email = `e2e-${word}@thesvcgroup.com`;

    await page.goto("/app/admin/team");
    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Create login" }) });
    await form.getByLabel(/^Email/).fill(email);
    await form.getByLabel("Name").fill(`Riley ${word}`);
    await form.getByLabel("Role").selectOption("rep");
    await expect(form.getByLabel(/Create login now/)).toBeChecked();
    await form.getByRole("button", { name: "Create login" }).click();

    const shown = page.getByTestId("temp-password");
    await expect(shown).toBeVisible();
    const temp = (await shown.textContent())!.trim();
    expect(temp).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    await expect(page.getByText(/Shown once/)).toBeVisible();
    await expect(memberRow(page, email)).toBeVisible();

    // The new rep signs in with the temporary password and must pick their own first.
    const repCtx = await newContext(browser);
    const rep = await repCtx.newPage();
    await signIn(rep, email, temp);
    await rep.waitForURL("**/welcome/password");
    await expect(rep.getByRole("heading", { level: 1, name: "Set your password" })).toBeVisible();
    // Going around it doesn't work.
    await rep.goto("/app/today");
    await rep.waitForURL("**/welcome/password");
    await rep.getByLabel("New password").fill("short");
    await rep.getByLabel("Type it again").fill("short");
    await rep.getByRole("button", { name: "Save and continue" }).click();
    await expect(rep.locator("p[role=alert]")).toContainText("at least 10");
    await rep.getByLabel("New password").fill("Memphis-roofs-2026");
    await rep.getByLabel("Type it again").fill("Memphis-roofs-2026");
    await rep.getByRole("button", { name: "Save and continue" }).click();
    await rep.waitForURL("**/app/today");
    await expect(rep.getByText("The Service Group").first()).toBeVisible();

    // Parks makes them a manager…
    await page.reload();
    await memberRow(page, email).getByRole("button", { name: /^Manage/ }).click();
    const dlg = page.locator("dialog[open]");
    await dlg.getByLabel("Role").selectOption("manager");
    await dlg.getByRole("button", { name: "Change role" }).click();
    await expect(toasts(page)).toContainText("is now manager");
    const prof = await eventually(async () => (await db.from("profile").select("id").eq("email", email).single()).data, (p) => !!p);
    const role = async () => (await db.from("membership").select("role,active").eq("user_id", prof!.id).single()).data;
    expect((await eventually(role, (m) => m?.role === "manager"))?.role).toBe("manager");
    await rep.goto("/app/team");
    await expect(rep.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();

    // …then deactivates them: their next request has no company.
    page.once("dialog", (d) => void d.accept());
    await dlg.getByRole("button", { name: "Deactivate" }).click();
    await expect(toasts(page)).toContainText("deactivated");
    expect((await eventually(role, (m) => m?.active === false))?.active).toBe(false);
    await rep.goto("/app/today");
    await rep.waitForURL("**/no-access");
    await repCtx.close();

    const { data: audit } = await db.from("admin_audit").select("action").eq("target_email", email);
    expect((audit ?? []).map((a) => a.action).sort()).toEqual(["member.deactivated", "member.login_created", "member.role_changed"]);
    // Parks can't change his own role or demote himself out of the last owner seat.
    // Close the sheet with its button (an Escape right after the confirm() can be swallowed by Chromium's close watcher).
    await page.locator("dialog[open]").getByRole("button", { name: "Close" }).click();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await memberRow(page, "team@dillyos.com").getByRole("button", { name: /^Manage/ }).click();
    await expect(page.locator("dialog[open]").getByText(/This is you/)).toBeVisible();
  });

  test("an email invite (no login) shows as pending and can be revoked", async ({ page }) => {
    const email = `e2e-${uniqueWord(2).toLowerCase()}@thesvcgroup.com`;
    await page.goto("/app/admin/team");
    const form = page.locator("form").filter({ has: page.getByLabel(/Create login now/) });
    await form.getByLabel(/Create login now/).uncheck();
    await form.getByLabel(/^Email/).fill(email);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(toasts(page)).toContainText(`Invited ${email}`);
    const row = page.getByRole("list", { name: "Pending invites" }).locator("li").filter({ hasText: email });
    await expect(row).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await row.getByRole("button", { name: `Revoke invite to ${email}` }).click();
    await expect(toasts(page)).toContainText("revoked");
    await expect(row).toHaveCount(0);
  });

  test("platform: add a company (system lists + owner login) and switch into it", async ({ page }) => {
    const word = uniqueWord(2).toLowerCase();
    const name = `E2E ${word[0]!.toUpperCase()}${word.slice(1)} Roofing`;
    await page.goto("/app/admin/platform");
    await expect(page.getByRole("list", { name: "Companies" })).toContainText("The Service Group");
    await expect(page.getByRole("list", { name: "Companies" })).toContainText("FOX Roofing");
    await page.getByLabel(/^Company name/).fill(name);
    await page.getByLabel("Short id (slug)").fill(`e2e-${word}`);
    await page.getByLabel("Primary market").selectOption("nashville");
    await page.getByLabel(/^First owner/).fill(`owner-${word}@example.com`);
    await page.getByRole("button", { name: "Add company" }).click();
    const done = page.getByRole("region", { name: "Company created" });
    await expect(done).toContainText(`${name} created`);
    await expect(done.getByTestId("temp-password")).toBeVisible();

    const { data: t } = await db.from("tenant").select("id").eq("slug", `e2e-${word}`).single();
    const { count: lists } = await db.from("list").select("id", { count: "exact", head: true }).eq("tenant_id", t!.id).eq("created_from", "system");
    expect(lists).toBe(6);
    const { data: owners } = await db.from("membership").select("role").eq("tenant_id", t!.id);
    expect(owners).toEqual([{ role: "owner" }]);

    await done.getByRole("button", { name: "Switch into it" }).click();
    await page.waitForURL("**/app/today");
    await expect(page.getByRole("button", { name: new RegExp(`Company: ${name}`) })).toBeVisible();
    await page.goto("/app/properties?tab=lists");
    await expect(page.getByRole("region", { name: "Built-in" }).getByRole("link")).toHaveCount(6);
  });
});

test.describe("Colby (rep)", () => {
  as("colby");
  test("Admin is a 404 and not in the profile menu", async ({ page }) => {
    for (const p of ["/app/admin", "/app/admin/team", "/app/admin/company", "/app/admin/platform"]) {
      const r = await page.goto(p);
      expect(r?.status(), p).toBe(404);
    }
    await page.goto("/app/today");
    await page.getByRole("button", { name: "Profile menu" }).click();
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  });
});

test.describe("Tyler (manager)", () => {
  as("tyler");
  test("sees Team members read-only; Company and Platform are 404", async ({ page }) => {
    await page.goto("/app/team");
    await page.getByRole("link", { name: "Admin" }).click();
    await page.waitForURL("**/app/admin/team");
    await expect(page.getByText("FOX Roofing · view only")).toBeVisible();
    await expect(page.getByRole("list", { name: "Members" })).toContainText("Kayla Smiley");
    await expect(page.getByRole("button", { name: /^Manage/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create login" })).toHaveCount(0);
    expect((await page.goto("/app/admin/company"))?.status()).toBe(404);
    expect((await page.goto("/app/admin/platform"))?.status()).toBe(404);
  });
});
