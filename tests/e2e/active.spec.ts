/**
 * Active pursuit: Morgan (TSG rep) marks 3 properties active (detail toggle + row toggle) → My active shows them (and is his
 * default tab) → Go's working list (getMyWorkingListStops) returns them first. A log at a building suggests
 * "Mark … active?" (never automatic). Accounts show who's working their buildings; managers see Who's working what.
 * (TSG/Morgan, so FOX reps' Go stays on its city fallback for the Go specs.)
 */
import { db, eventually, fxAccount, fxProperty, userId, uniqueWord } from "./support/db";
import { as, expect, newContext, settle, tap, test, tile, toasts } from "./support/ui";

test.describe("Morgan (TSG rep) works his own properties", () => {
  as("tsgrep");

  test("mark 3 active → My active shows them → working list returns them first", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const city = `Act${uniqueWord(2)}`;
    const acct = await fxAccount({ tenant: "tsg", owner: "tsgrep", city });
    const [a, b, c] = await Promise.all([1, 2, 3].map((i) => fxProperty({ tenant: "tsg", accountId: acct.id, city, name: `${city} Lofts ${i}` })));
    const morgan = await userId("tsgrep");

    // 1) From the property page.
    await page.goto(`/app/properties/${a!.id}`);
    await page.getByRole("button", { name: `Mark ${a!.name} active` }).click();
    await expect(toasts(page)).toContainText("Marked active");
    await expect(page.getByRole("button", { name: new RegExp(`${a!.name} is active`) })).toHaveAttribute("aria-pressed", "true");

    // 2) + 3) Quick toggles on the Properties rows.
    await page.goto(`/app/properties?tab=all&city=${city}`);
    for (const p of [b!, c!]) {
      await page.getByRole("button", { name: `Mark ${p.name} active` }).click();
      await expect(page.getByRole("button", { name: new RegExp(`${p.name} is active`) })).toBeVisible();
    }
    await eventually(async () => (await db.from("property_pursuit").select("property_id").eq("user_id", morgan).eq("status", "active")).data ?? [], (r) => r.length >= 3);

    // My active is a rep's default tab once they have anything active.
    await page.goto("/app/properties");
    await expect(page.getByRole("navigation", { name: "Property views" }).getByRole("link", { name: /My active/ })).toHaveAttribute("aria-current", "page");
    for (const p of [a!, b!, c!]) await expect(page.locator("main li").filter({ hasText: p.name })).toBeVisible();
    await expect(page.locator("main").getByText(/^\d+ active$/)).toBeVisible();

    // Go's working list: the three active buildings come first.
    const wl = await (await page.request.get("/app/lists/working")).json();
    const stops = wl.stops as { propertyId: string; source: string }[];
    expect(stops.slice(0, 3).map((s) => s.propertyId).sort()).toEqual([a!.id, b!.id, c!.id].sort());
    expect(stops.slice(0, 3).every((s) => s.source === "active")).toBe(true);

    // The account shows who's working its buildings; Tyler sees it in Who's working what.
    await page.goto(`/app/accounts/${acct.id}`);
    await expect(page.getByRole("region", { name: "Who's working these buildings" })).toContainText("Actively worked by You (3)");
    const ctx = await newContext(browser, "team");
    const t = await ctx.newPage();
    await t.goto("/app/team/working");
    await expect(t.getByRole("region", { name: "Morgan Hale" })).toContainText(`${city} Lofts 1`);
    await t.goto("/app/team");
    await expect(t.getByRole("heading", { name: "Who's working what" })).toBeVisible();
    await ctx.close();

    // Dropping one takes it off My active.
    await page.goto("/app/properties?tab=active");
    await page.getByRole("button", { name: new RegExp(`${c!.name} is active`) }).click();
    await expect(toasts(page)).toContainText("No longer active");
    await page.reload();
    await expect(page.locator("main li").filter({ hasText: c!.name })).toHaveCount(0);
    const { data: hist } = await db.from("property_pursuit").select("status,ended_at").eq("property_id", c!.id).eq("user_id", morgan);
    expect(hist).toEqual([{ status: "dropped", ended_at: expect.any(String) }]);
  });

  test("logging at a building suggests marking it active (never automatic)", async ({ page }) => {
    const city = `Sug${uniqueWord(2)}`;
    const acct = await fxAccount({ tenant: "tsg", owner: "tsgrep", city });
    const p = await fxProperty({ tenant: "tsg", accountId: acct.id, city, name: `${city} Commons` });
    await page.goto(`/app/properties/${p.id}`);
    await page.getByRole("button", { name: "Log at this building" }).click();
    const dlg = page.locator("dialog[open]");
    await tap(page, tile(dlg, "Site visit"));
    await tap(page, tile(dlg, "Not there"));
    const nudge = page.getByRole("dialog", { name: "Mark active" });
    await expect(nudge).toContainText(`Mark ${p.name} active?`);
    const { data: none } = await db.from("property_pursuit").select("id").eq("property_id", p.id);
    expect(none).toEqual([]);
    await nudge.getByRole("button", { name: "Mark active" }).click();
    await expect(toasts(page)).toContainText("Marked active");
    await settle(page);
    const { data: one } = await db.from("property_pursuit").select("status").eq("property_id", p.id);
    expect(one).toEqual([{ status: "active" }]);
  });
});
