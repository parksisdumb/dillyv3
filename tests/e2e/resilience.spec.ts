/**
 * Field reality: bad signal, and a Supabase blip. Runs in its own project after everything else because it stops the
 * shared stack gateway.
 */
import { fxAccount, fxTask } from "./support/db";
import { setServerDelay, startGateway, stopGateway } from "./support/stack";
import { as, expect, queueRow, sheet, test, tile, toasts } from "./support/ui";

as("colby");

test.afterEach(async () => {
  await startGateway();
  await setServerDelay(0).catch(() => {});
});

test.describe("Supabase gateway goes down mid-session", () => {
  test("navigating shows an error screen (not a white page, not a fake sign-out) and recovers after restart", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

    await stopGateway();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Accounts" }).click();
    await page.waitForTimeout(2000);
    const body = (await page.locator("body").innerText()).trim();
    expect(body.length, "page must not be blank").toBeGreaterThan(20);
    // Either the in-app error boundary, or the login page's "can't reach the server" notice (session kept) —
    // never a bare sign-in form that looks like the rep was logged out.
    await expect(page.getByText(/didn.t load|no signal|can.t reach the server|couldn.t (load|reach)/i).first()).toBeVisible();
    if (page.url().includes("/login")) expect(page.url()).toContain("offline=1");

    await startGateway();
    const retry = page.getByRole("button", { name: /try again/i }).or(page.getByRole("link", { name: /try again/i })).first();
    await retry.click();
    await expect(page.getByRole("navigation", { name: "Book" })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/app\/accounts/);
  });

  // Known bug: BUGS.md#b8 — the server action redirects the whole page to /login?offline=1.
  test.fixme("opening the Log sheet while Supabase is down explains it instead of hanging", async ({ page }) => {
    await page.goto("/app/today");
    await stopGateway();
    await page.getByRole("button", { name: "Log a touch" }).click();
    await expect(sheet(page).getByText("Couldn't load. Check signal and try again.")).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toContain("/app/today");
  });

  test("after a blip the session is intact — no re-login needed", async ({ page }) => {
    await page.goto("/app/today");
    await stopGateway();
    await page.goto("/app/pipeline").catch(() => {});
    await startGateway();
    await page.goto("/app/pipeline");
    await expect(page).toHaveURL(/\/app\/pipeline/);
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  });
});

test.describe("Slow network", () => {
  test("3s server-side delay on /rest/v1: navigation gives feedback and completes", async ({ page }) => {
    await page.goto("/app/today");
    await setServerDelay(3000);
    const t0 = Date.now();
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Pipeline" }).click();
    // Within a second the rep should see that something is happening (route loading UI / skeleton / busy state).
    await expect(page.locator("[aria-busy=true], [role=progressbar], .animate-pulse, :text('Loading')").first()).toBeVisible({ timeout: 1500 });
    await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - t0).toBeGreaterThan(2500);
  });

  test("3s server-side delay: the Log sheet shows Loading… then Logging…, and the log completes", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Slow-net ${acct.name}`, kind: "follow_up", due: 0 });
    await page.goto("/app/today");
    await setServerDelay(3000);
    await queueRow(page, t.title).getByRole("button", { name: "Log", exact: true }).click();
    const s = sheet(page);
    await expect(s.getByText("Loading…")).toBeVisible();
    await tile(s, "Call").click({ timeout: 30_000 });
    await tile(s, "Left voicemail").click();
    await expect(s.getByText("Logging…")).toBeVisible();
    await expect(s.getByRole("button", { name: /^Left voicemail/ })).toBeDisabled();
    await expect(toasts(page)).toContainText(/follow-up closed/, { timeout: 45_000 });
  });

  test("3s browser-side delay on every request (bad cell signal): Today still loads and logging works", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const t = await fxTask({ accountId: acct.id, title: `Bad-signal ${acct.name}`, kind: "follow_up", due: 0 });
    await page.route("**/*", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await page.goto("/app/today", { timeout: 60_000 });
    await queueRow(page, t.title).getByRole("button", { name: "Log", exact: true }).click();
    const s = sheet(page);
    await tile(s, "Call").click({ timeout: 30_000 });
    await tile(s, "No answer").click();
    await expect(s.getByText("Logging…")).toBeVisible();
    await expect(toasts(page)).toContainText(/follow-up closed/, { timeout: 45_000 });
  });
});
