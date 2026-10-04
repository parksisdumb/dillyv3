/**
 * PWA + push + small field fixes: manifest, offline page, service worker fallback, Settings → Notifications states,
 * the iOS install hint, digits-only phone search, and "+ Opportunity" from a property.
 * (The OS permission prompt can't be driven headless; the states around it are faked with init scripts.)
 */
import { db, fxAccount, fxProperty, userId } from "./support/db";
import { as, expect, test, toasts } from "./support/ui";

test.describe("installable app", () => {
  test("manifest is served as application/manifest+json with name and icons", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/manifest+json");
    const m = await res.json();
    expect(m).toMatchObject({ name: "Dilly", short_name: "Dilly", start_url: "/app/today", display: "standalone" });
    const sizes = (m.icons as { sizes: string; purpose: string; src: string }[]).map((i) => `${i.sizes}:${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "192x192:maskable", "512x512:maskable"]));
    for (const i of m.icons as { src: string }[]) {
      const icon = await request.get(i.src);
      expect(icon.status(), i.src).toBe(200);
      expect(icon.headers()["content-type"]).toBe("image/png");
    }
  });

  test("pages link the manifest, the apple-touch-icon and the iOS web-app metas", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute("content", "yes");
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveCount(1);
  });

  test("the service worker script is served fresh", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
    expect(res.headers()["cache-control"]).toContain("no-cache");
  });

  test("/offline renders without signing in and explains queued logging", async ({ page }) => {
    const res = await page.goto("/offline");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "No signal." })).toBeVisible();
    await expect(page.getByText(/Logging still works without signal/)).toBeVisible();
    await expect(page.getByText(/saved on this phone and send by themselves/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("the service worker installs, controls the page, and precaches only /offline + static assets", async ({ browser }) => {
    const ctx = await browser.newContext({ serviceWorkers: "allow", baseURL: test.info().project.use.baseURL });
    const page = await ctx.newPage();
    try {
      await page.goto("/login");
      await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready), null, { timeout: 20_000 });
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20_000 });
      // Only static assets are cached — never page HTML.
      const cached = await page.evaluate(async () => {
        const out: string[] = [];
        for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
        return out;
      });
      expect(cached).toContain("/offline");
      expect(cached.filter((p) => p !== "/offline" && !p.startsWith("/_next/static/") && !p.startsWith("/icons/"))).toEqual([]);
      // The fallback itself (fetch fails → cached /offline) can't be driven here: Playwright's setOffline doesn't
      // reach a service worker's own fetches. The cached page is the one /offline renders (test above).
      const offline = await page.evaluate(async () => (await (await caches.match("/offline"))?.text()) ?? "");
      expect(offline).toContain("No signal.");
    } finally {
      await ctx.close();
    }
  });
});

test.describe("Settings → Notifications (Colby)", () => {
  as("colby");

  test.beforeEach(async () => {
    await db.from("push_subscription").delete().eq("user_id", await userId("colby"));
  });

  test("explains reminders before asking, shows quiet hours, lists devices and removes one", async ({ page }) => {
    const uid = await userId("colby");
    const { data: m } = await db.from("membership").select("tenant_id").eq("user_id", uid).limit(1).single();
    await db.from("push_subscription").insert({
      tenant_id: m!.tenant_id,
      user_id: uid,
      endpoint: `https://push.example.invalid/e2e-${Date.now()}`,
      p256dh: "e2e",
      auth: "e2e",
      user_agent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
    });

    await page.goto("/app/settings#notifications");
    const section = page.locator("section#notifications");
    await expect(section.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(section.getByText("Get reminders on this phone")).toBeVisible();
    await expect(section.getByText(/At most 3 a day/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Turn on reminders" })).toBeEnabled();
    await expect(section.getByText(/Reminders go out 7 AM–7 PM, weekdays only/)).toBeVisible();
    await expect(section.getByRole("button", { name: "Send test notification" })).toBeVisible();

    const devices = section.getByRole("list", { name: "My devices" });
    await expect(devices.getByText("Android · Chrome")).toBeVisible();
    await devices.getByRole("button", { name: "Remove" }).click();
    await expect(toasts(page)).toContainText("Device removed");
    await expect(devices.getByText("No devices yet")).toBeVisible();
    await expect(section.getByRole("button", { name: "Send test notification" })).toHaveCount(0);
  });

  test("blocked notifications: shows how to allow them again", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(Notification, "permission", { get: () => "denied" }));
    await page.goto("/app/settings");
    const section = page.locator("section#notifications");
    await expect(section.getByText("Notifications are blocked for Dilly on this phone.")).toBeVisible();
    await expect(section.getByText(/Settings → Notifications → Dilly/)).toBeVisible(); // iPhone UA in the mobile project
    await expect(section.getByRole("button", { name: "Turn on reminders" })).toHaveCount(0);
  });

  test("iPhone Safari outside the home-screen app: explains Add to Home Screen first", async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as { PushManager?: unknown }).PushManager;
    });
    await page.goto("/app/settings");
    const section = page.locator("section#notifications");
    await expect(section.getByText("To get reminders on iPhone, add Dilly to your Home Screen first.")).toBeVisible();
    await expect(section.getByText(/iOS 16.4 or later/)).toBeVisible();
  });

  test("Today shows the one-time install hint on iPhone Safari; dismissing it sticks", async ({ page }) => {
    await page.goto("/app/today");
    const hint = page.getByRole("complementary", { name: "Install Dilly" });
    await expect(hint).toContainText("Add Dilly to your home screen");
    await hint.getByRole("button", { name: "Dismiss install hint" }).click();
    await expect(hint).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("dilly:install-hint-dismissed"))).toBe("1");
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => {});
    await expect(page.getByRole("complementary", { name: "Install Dilly" })).toHaveCount(0);
  });
});

test.describe("field fixes (Colby)", () => {
  as("colby");

  test("contact search finds a phone number typed with different formatting", async ({ page }) => {
    const { data: dana } = await db.from("contact").select("id,full_name,phone").eq("full_name", "Dana Whitfield").limit(1).single();
    const d = dana!.phone!.replace(/\D/g, "");
    expect(d.length).toBe(10);
    for (const q of [`${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`, `+1 ${d}`]) {
      await page.goto(`/app/contacts?q=${encodeURIComponent(q)}`);
      await expect(page.locator(`main a[href="/app/contacts/${dana!.id}"]`).first(), q).toBeVisible();
    }
    await page.goto(`/app/search?q=${encodeURIComponent(`${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`)}`);
    await expect(page.locator(`main a[href="/app/contacts/${dana!.id}"]`).first()).toBeVisible();
  });

  test("+ Opportunity from a property pre-fills the property and its account", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const prop = await fxProperty({ accountId: acct.id });
    await page.goto(`/app/properties/${prop.id}`);
    await page.getByRole("link", { name: "+ Opportunity" }).click();
    await expect(page).toHaveURL(new RegExp(`/app/pipeline/new\\?property=${prop.id}`));
    await expect(page.locator('select[name="account_id"]')).toHaveValue(acct.id);
    await expect(page.locator('select[name="property_id"]')).toHaveValue(prop.id);
  });

  test("+ Opportunity from a property with no account still pre-fills the property", async ({ page }) => {
    const prop = await fxProperty({ accountId: null });
    await page.goto(`/app/properties/${prop.id}`);
    await page.getByRole("link", { name: "+ Opportunity" }).click();
    await expect(page.locator('select[name="property_id"]')).toHaveValue(prop.id);
  });
});
