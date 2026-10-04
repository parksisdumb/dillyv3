/**
 * Field kit: offline log queue, photos, business-card scan fallback, route for the day, browser error reports.
 * Runs against the local stack with STORAGE_DRIVER=local (photos on disk, served by /api/media/file).
 */
import type { Page } from "@playwright/test";
import { db, eventually, fxAccount, fxProperty, pointsFor, tenantId, touchesForAccount, uniqueWord } from "./support/db";
import { as, expect, sheet, tap, test, tile, toasts } from "./support/ui";

as("colby");

const pill = (page: Page) => page.getByTestId("queue-pill");

/** A small real JPEG made by the browser's own encoder. */
async function jpeg(page: Page, label = "roof"): Promise<Buffer> {
  const b64 = await page.evaluate((text) => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 480;
    const g = c.getContext("2d")!;
    g.fillStyle = "#8a9096";
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = "#ffffff";
    g.font = "48px sans-serif";
    g.fillText(text, 40, 260);
    return c.toDataURL("image/jpeg", 0.8).split(",")[1];
  }, label);
  return Buffer.from(b64, "base64");
}

async function buildingFixture() {
  const acct = await fxAccount({ owner: "colby", tier: 2 });
  const prop = await fxProperty({ accountId: acct.id });
  return { acct, prop };
}

async function openLogAtBuilding(page: Page, propertyId: string) {
  await page.goto(`/app/properties/${propertyId}`);
  await tap(page, page.getByRole("button", { name: "Log at this building" }));
  const s = sheet(page);
  await expect(tile(s, "Site visit")).toBeVisible(); // context loaded while online
  return s;
}

test.describe("offline log queue", () => {
  test("no signal → saved on the phone (pill: 1 queued) → back online → logged exactly once, on the timeline", async ({ page, context }) => {
    const { acct, prop } = await buildingFixture();
    const s = await openLogAtBuilding(page, prop.id);

    await context.setOffline(true);
    await tap(page, tile(s, "Site visit"));
    await tap(page, tile(s, "Met in person"));
    await expect(toasts(page)).toContainText("Waiting for signal · 1 queued");
    await expect(pill(page)).toHaveText(/Waiting for signal · 1 queued/);
    await expect(s).toHaveCount(0);
    expect(await touchesForAccount(acct.id)).toHaveLength(0);

    // The queue survives a look at what's waiting.
    await tap(page, pill(page));
    await expect(sheet(page).getByText(/Site visit · Met in person/)).toBeVisible();
    await page.keyboard.press("Escape");

    await context.setOffline(false); // fires `online` → replay
    await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });
    const touches = await eventually(() => touchesForAccount(acct.id), (t) => t.length >= 1);
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ channel: "site_visit", outcome: "met_in_person" });

    await page.reload();
    const timeline = page.locator("ol").filter({ hasText: "Site visit" });
    await expect(timeline.locator("li")).toHaveCount(1);
    await expect(timeline.getByText("Met in person")).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await touchesForAccount(acct.id)).toHaveLength(1);
  });

  test("answer lost after the server logged it → queued → racing replays still log once", async ({ page }) => {
    const { acct, prop } = await buildingFixture();
    const s = await openLogAtBuilding(page, prop.id);

    // The log reaches the server and is written, but the phone never hears back (signal dropped mid-response).
    let dropped = false;
    await page.route(`**/app/properties/${prop.id}`, async (route) => {
      const req = route.request();
      if (!dropped && req.method() === "POST" && (req.postData() ?? "").includes("idempotencyKey")) {
        dropped = true;
        await route.fetch(); // the server action runs and commits
        await route.abort("internetdisconnected");
        return;
      }
      await route.continue();
    });
    await tap(page, tile(s, "Call"));
    await tap(page, tile(s, "Connected"));
    await expect(toasts(page)).toContainText("Waiting for signal · 1 queued");
    expect(dropped).toBe(true);
    expect(await touchesForAccount(acct.id)).toHaveLength(1); // the server has it already
    await page.unroute(`**/app/properties/${prop.id}`);

    // online + visibilitychange + another online, all at once: one replay runs, with the same idempotency key.
    await page.evaluate(() => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(pill(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(toasts(page)).toContainText("Sent your queued log");
    await page.waitForTimeout(1500);
    const touches = await touchesForAccount(acct.id);
    expect(touches).toHaveLength(1);
    expect(touches[0]).toMatchObject({ channel: "call", outcome: "connected" });
    // Replaying again (e.g. a reload on app open) finds nothing to send.
    await page.reload();
    await page.waitForTimeout(1500);
    expect(await touchesForAccount(acct.id)).toHaveLength(1);
    await expect(pill(page)).toHaveCount(0);
  });
});

test.describe("photos", () => {
  test("a roof walk with a photo: site-walk points, and the photo shows on the property", async ({ page, playwright }) => {
    const { acct, prop } = await buildingFixture();
    const s = await openLogAtBuilding(page, prop.id);
    await tap(page, tile(s, "Roof walk"));
    await tap(page, s.getByRole("button", { name: /Notes, who I met, follow-up/ }));
    await s.getByLabel("Add photos").setInputFiles({ name: "roof.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, "west drain") });
    await expect(s.getByRole("img", { name: "Photo to attach" })).toHaveCount(1);
    // The outcome tile shows the site-walk bonus once a photo is attached.
    await expect(tile(s, "Met in person")).toContainText("+16");
    await tap(page, tile(s, "Met in person"));
    await expect(toasts(page)).toContainText(/\+16/);

    const pts = await eventually(() => pointsFor("colby", { accountId: acct.id, event: "site_walk_completed" }), (p) => p.length === 1);
    expect(pts).toHaveLength(1);
    const { data: photos } = await db.from("photo").select("id,path,property_id,touch_id,width,height").eq("property_id", prop.id);
    expect(photos).toHaveLength(1);
    expect(photos![0].path).toMatch(new RegExp(`^${await tenantId("fox")}/\\d{4}/\\d{2}/[0-9a-f-]{36}\\.jpg$`));
    expect(photos![0]).toMatchObject({ width: 640, height: 480 });

    await page.reload();
    const section = page.getByTestId("property-photos");
    await expect(section.getByText("1 photo")).toBeVisible();
    const img = section.locator("img").first();
    await expect(img).toHaveAttribute("src", /^\/api\/media\/file\//);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(0);
    // Signed-out requests can't fetch it.
    const src = (await img.getAttribute("src"))!;
    const anon = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } });
    expect((await anon.get(src)).status()).toBe(401);
    await anon.dispose();
  });

  test("Photos section: add with a caption straight onto the building", async ({ page }) => {
    const { prop } = await buildingFixture();
    await page.goto(`/app/properties/${prop.id}`);
    const section = page.getByTestId("property-photos");
    await section.getByLabel("Add photos").setInputFiles({ name: "a.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, "seam") });
    await section.getByPlaceholder("Caption for photo 1 (optional)").fill("Seam split on C");
    await tap(page, section.getByRole("button", { name: "Save 1 photo" }));
    await expect(toasts(page)).toContainText("Photo added");
    await expect(section.getByText("Seam split on C")).toBeVisible();
    await expect(section.getByText(/Colby Remedios/)).toBeVisible();
    const { data } = await db.from("photo").select("caption,touch_id").eq("property_id", prop.id);
    expect(data).toEqual([{ caption: "Seam split on C", touch_id: null }]);
  });
});

test.describe("business-card scan", () => {
  test("without an API key the scan explains itself and the rep types it in; the card photo is kept", async ({ page }) => {
    const name = `${uniqueWord(2)} ${uniqueWord(2)}`;
    await page.goto("/app/contacts/new?source=field&back=/app/go");
    const scan = page.getByTestId("card-scan");
    await expect(scan.getByRole("button", { name: "Scan business card" })).toBeVisible();
    await scan.getByLabel("Business card photo").setInputFiles({ name: "card.jpg", mimeType: "image/jpeg", buffer: await jpeg(page, "Rachel Ibarra") });
    await expect(scan.getByRole("status")).toHaveText(/Card reading isn't switched on yet — type the details in/, { timeout: 20_000 });

    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Title").fill("Director of Facilities");
    await tap(page, page.getByRole("button", { name: "Add contact" }));
    await expect(toasts(page)).toContainText(`Added ${name}`);
    const { data } = await db.from("contact").select("source_image_path,source").ilike("full_name", name).single();
    expect(data!.source).toBe("field");
    expect(data!.source_image_path).toMatch(/^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    // Each scan is an agent run (cost tracking), even when it falls back.
    const { data: runs } = await db.from("agent_run").select("status,outputs").eq("agent_key", "card-scan").order("started_at", { ascending: false }).limit(1);
    expect(runs?.[0]).toMatchObject({ status: "succeeded", outputs: { outcome: "not_configured" } });
  });
});

test.describe("route for the day", () => {
  test.use({ geolocation: { latitude: 30.4, longitude: -97.7 }, permissions: ["geolocation"] });

  test("Route orders today's stops from my location and opens Google Maps with them in order", async ({ page }) => {
    const city = `${uniqueWord(2)}ville`;
    // Three buildings due north of each other; I'm north of all of them → C, B, A.
    const mk = async (label: string, lat: number) => {
      const acct = await fxAccount({ owner: "colby", tier: 1, name: `${label} ${uniqueWord(2)} Holdings`, city });
      // Top of my ranked book, so today's Go list includes it whatever else the suite created.
      await db.from("account").update({ score: 60 }).eq("id", acct.id);
      const { data, error } = await db
        .from("property")
        .insert({ tenant_id: await tenantId("fox"), account_id: acct.id, name: `${label} Bldg`, address1: `${Math.round(lat * 100)} ${label} Rd`, city, state: "TX", lat, lng: -97.7, geocoded_at: new Date().toISOString(), geocode_source: "manual", source: "rep" })
        .select("id,address1")
        .single();
      if (error) throw new Error(error.message);
      return { acct, address: `${data!.address1}, ${city}, TX` };
    };
    const A = await mk("Alpha", 30.1);
    const B = await mk("Bravo", 30.2);
    const C = await mk("Charlie", 30.3);

    await page.goto(`/app/go?city=${encodeURIComponent(city)}`);
    await expect(page.getByRole("article")).toHaveAttribute("aria-label", "Stop 1 of 3");
    await tap(page, page.getByRole("button", { name: "Route" }));
    const panel = page.getByTestId("route-panel");
    await expect(panel.getByText("Starting from where you are.")).toBeVisible();
    const items = panel.getByRole("list", { name: "Stops in route order" }).locator("li");
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText(C.acct.name);
    await expect(items.nth(1)).toContainText(B.acct.name);
    await expect(items.nth(2)).toContainText(A.acct.name);
    await expect(items.nth(1)).toContainText(/\d+(\.\d)? mi/);

    const href = await panel.getByTestId("maps-route").getAttribute("href");
    const u = new URL(href!);
    expect(u.origin + u.pathname).toBe("https://www.google.com/maps/dir/");
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("origin")).toBe("30.400000,-97.700000");
    expect(u.searchParams.get("waypoints")!.split("|")).toEqual([C.address, B.address]);
    expect(u.searchParams.get("destination")).toBe(A.address);
    await expect(panel.getByTestId("maps-route")).toHaveAttribute("target", "_blank");

    // "Go through stops in this order" re-sequences the session.
    await tap(page, panel.getByRole("button", { name: "Go through stops in this order" }));
    await expect(page.getByRole("article").getByRole("heading", { level: 2 })).toHaveText(C.acct.name);
  });
});

test.describe("browser error reporting", () => {
  test("an uncaught error in the page reaches /api/client-error (with ids, no PII)", async ({ page }) => {
    // Chromium hides beacon bodies from request events: record what the page hands to sendBeacon, then send it for real.
    await page.addInitScript(() => {
      const w = window as unknown as { __beacons: string[] };
      w.__beacons = [];
      const orig = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        if (data instanceof Blob) void data.text().then((t) => w.__beacons.push(t));
        return orig(url, data);
      };
    });
    await page.goto("/app/today");
    const marker = `e2e boom ${uniqueWord(2)}`;
    const beacon = page.waitForRequest((r) => r.url().endsWith("/api/client-error") && r.method() === "POST", { timeout: 20_000 });
    await page.evaluate((m) => {
      setTimeout(() => {
        throw new Error(m);
      }, 0);
    }, marker);
    const req = await beacon;
    expect((await req.response())?.status()).toBe(204);
    const sent = await page.waitForFunction((m) => (window as unknown as { __beacons: string[] }).__beacons.find((b) => b.includes(m)), marker);
    const body = JSON.parse((await sent.jsonValue()) as string);
    expect(body.errors[0]).toMatchObject({ message: marker, kind: "error" });
    expect(body.errors[0].user).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.errors[0].tenant).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("colby@foxroofing.co");
    // The endpoint answers 204 with a request id; junk is rejected.
    const ok = await page.request.post("/api/client-error", { data: { message: "direct" } });
    expect(ok.status()).toBe(204);
    expect(ok.headers()["x-request-id"]).toBeTruthy();
    expect((await page.request.post("/api/client-error", { data: "nope", headers: { "content-type": "application/json" } })).status()).toBe(400);
  });
});

test.describe("page loads (B10)", () => {
  test("a full page load never holds a second, hidden copy of the screen", async ({ page }) => {
    const { acct, prop } = await buildingFixture();
    await page.addInitScript(() => {
      const w = window as unknown as { __maxH1: number; __hiddenSegments: number };
      w.__maxH1 = 0;
      w.__hiddenSegments = 0;
      const t0 = performance.now();
      const tick = () => {
        w.__maxH1 = Math.max(w.__maxH1, document.querySelectorAll("h1").length);
        const seg = [...document.querySelectorAll('div[hidden][id^="S:"]')].filter((d) => (d.textContent ?? "").trim().length > 0).length;
        w.__hiddenSegments = Math.max(w.__hiddenSegments, seg);
        if (performance.now() - t0 < 4000) setTimeout(tick, 2);
      };
      tick();
    });
    for (const path of [`/app/properties/${prop.id}`, `/app/accounts/${acct.id}`, "/app/pipeline", "/app/today", "/app/properties"]) {
      await page.goto(path);
      await page.reload();
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const w = window as unknown as { __maxH1: number; __hiddenSegments: number };
        return { h1: w.__maxH1, hidden: w.__hiddenSegments };
      });
      expect(r, path).toEqual({ h1: 1, hidden: 0 });
    }
  });
});
