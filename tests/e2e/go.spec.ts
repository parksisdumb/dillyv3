import { db, eventually, touchesForAccount } from "./support/db";
import { as, expect, sheet, tap, test, tile, toasts } from "./support/ui";

as("colby");

test.describe("Go — My day", () => {
  test("no In person / Calls split: logging at a stop opens the Log sheet pre-filled; the channel is picked there", async ({ page }) => {
    await page.goto("/app/go?city=Austin");
    await expect(page.getByRole("heading", { level: 1, name: "My day" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByTestId("today-appointments")).toBeVisible();
    // Every stop has its own Log button: the floating one is hidden.
    await expect(page.getByRole("button", { name: "Log a touch" })).toHaveCount(0);

    const stop = page.getByTestId("stop").first();
    await expect(stop).toBeVisible();
    const label = (await stop.getAttribute("aria-label"))!.replace(/^Stop 1: /, "");
    await tap(page, stop.getByRole("button", { name: `Log at ${label}` }));
    const log = sheet(page);
    await expect(log).toBeVisible();
    // Account (and building) come pre-filled: straight to "How".
    await expect(log.getByRole("region", { name: "How" })).toBeVisible();
    const acctName = (await log.locator("#log-sheet-title").textContent())!.trim();
    const { data: acct } = await db.from("account").select("id").eq("name", acctName).limit(1).single();
    const before = (await touchesForAccount(acct!.id)).length;
    await tap(page, tile(log, "Door knock"));
    await tap(page, tile(log, "Not there"));
    await expect(toasts(page)).toContainText(/Revisit/);
    const after = await eventually(() => touchesForAccount(acct!.id), (t) => t.length === before + 1);
    expect(after.find((x) => x.outcome === "not_there")).toMatchObject({ channel: "door_knock" });
    // The refreshed list can re-rank stops after a touch: find this stop by name, not position.
    const same = page.getByTestId("stop").filter({ has: page.getByRole("button", { name: `Log at ${label}`, exact: true }) });
    await expect(same).toContainText(/Logged today/);
  });

  test("Log with a person at a stop → the sheet picks them", async ({ page }) => {
    await page.goto("/app/go?city=Austin");
    const stops = page.getByTestId("stop");
    await expect(stops.first()).toBeVisible();
    // Find a stop with people.
    const n = await stops.count();
    for (let i = 0; i < n; i++) {
      const st = stops.nth(i);
      await tap(page, st.getByRole("button", { name: /^More for / }));
      const people = st.getByRole("button", { name: /^Log with / });
      if ((await people.count()) === 0) continue;
      const who = (await people.first().textContent())!.trim();
      await tap(page, people.first());
      await expect(sheet(page).getByRole("region", { name: "Who" })).toContainText(who);
      return;
    }
    test.skip(true, "no stop with people in Austin");
  });

  test("Person button opens the standalone 'Add person I met' page", async ({ page }) => {
    await page.goto("/app/go?city=Austin");
    await tap(page, page.getByRole("link", { name: "Add a person I met" }));
    await expect(page.getByRole("heading", { level: 1, name: "Add person I met" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/app/go");
  });
});

test.describe("Go — Call through this list", () => {
  test("a button on the list, not a mode: outcome buttons log the call and move to the next dial", async ({ page }) => {
    await page.goto("/app/go?city=Austin");
    await tap(page, page.getByRole("link", { name: "Call through this list" }));
    await expect(page).toHaveURL(/\/app\/go\?mode=calls/);
    await expect(page.getByRole("heading", { level: 1, name: "Call through the list" })).toBeVisible();
    const card = page.getByRole("article");
    await expect(card).toHaveAttribute("aria-label", /^Call 1 of \d+$/);
    await expect(card.getByRole("link", { name: /\(\d{3}\) \d{3}-\d{4}/ })).toHaveAttribute("href", /^tel:/);
    for (const o of ["Connected", "Left voicemail", "No answer", "Gatekeeper", "Call back later", "Booked inspection", "Not interested"]) {
      await expect(card.getByRole("button", { name: new RegExp(`^${o} \\+\\d+$`) })).toBeVisible();
    }
    await tap(page, card.getByRole("button", { name: /^Left voicemail/ }));
    await expect(toasts(page)).toContainText(/next: Call .+ back/);
    await expect(page.getByRole("article")).toHaveAttribute("aria-label", /^Call 2 of \d+$/);
    await expect(sheet(page)).toHaveCount(0);
    // Old links keep working.
    await page.goto("/app/go?mode=focus");
    await expect(page.getByRole("heading", { level: 1, name: "Call through the list" })).toBeVisible();
  });
});
