/**
 * Lists: a manager saves a Properties filter as a list and assigns it to Morgan (TSG rep) → it's on his Lists tab and feeds his
 * working list; system lists show the right counts; multi-select → Add to list; list page progress/sort/export.
 */
import { db, dayOffset, eventually, fxAccount, fxProperty, tenantId, uniqueWord, userId } from "./support/db";
import { as, expect, newContext, test, toasts } from "./support/ui";
import type { Page } from "@playwright/test";

test.describe("Parks (TSG owner) builds and assigns a list", () => {
  as("team");

  test("save a filter as a list → assign to Morgan → it's on his Lists tab and in his working list", async ({ page, browser }) => {
    test.setTimeout(120_000);
    const city = `Lst${uniqueWord(2)}`;
    const acct = await fxAccount({ tenant: "tsg", owner: "tsgrep", city });
    const props = await Promise.all([1, 2, 3].map((i) => fxProperty({ tenant: "tsg", accountId: acct.id, city, name: `${city} Plaza ${i}`, year: 1999 + i })));
    const name = `Old roofs in ${city}`;

    await page.goto(`/app/properties?tab=all&city=${city}&sort=age`);
    await expect(page.locator("main li").filter({ hasText: `${city} Plaza 1` })).toBeVisible();
    await page.getByRole("button", { name: "Save as list" }).click();
    const dlg = page.locator("dialog[open]");
    await dlg.getByLabel("Name").fill(name);
    await dlg.getByText(/^Fixed · these 3/).click();
    await dlg.getByRole("button", { name: "Save list" }).click();
    await page.waitForURL(/\/app\/lists\/[0-9a-f-]{36}$/);
    const listId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByTestId("list-progress")).toHaveText(/0 of 3 touched in the last 30 days/);
    // Sort: oldest roof first.
    await page.getByRole("link", { name: "Oldest roof" }).click();
    // Wait for the sorted page to commit: a search-param change remounts the page, which would close a sheet opened mid-navigation.
    await expect(page.getByRole("link", { name: "Oldest roof" })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("list", { name: "List properties" }).locator("li").first()).toContainText(`${city} Plaza 1`);
    // CSV export carries the buildings.
    const csv = await page.request.get(`/app/lists/${listId}/export`);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain(`${city} Plaza 2`);

    await page.getByRole("button", { name: "Assign to reps" }).click();
    const assign = page.locator("dialog[open]");
    await assign.locator("label").filter({ hasText: "Morgan Hale" }).getByRole("checkbox").check();
    await assign.getByRole("button", { name: "Assign to 1" }).click();
    await expect(toasts(page)).toContainText("Assigned to 1 rep");
    const morgan = await userId("tsgrep");
    await eventually(async () => (await db.from("list_assignment").select("user_id").eq("list_id", listId)).data ?? [], (r) => r.some((a) => a.user_id === morgan));

    // Morgan: Lists → Assigned to you; Go's working list includes its untouched buildings.
    const ctx = await newContext(browser, "tsgrep");
    const k = await ctx.newPage();
    await k.goto("/app/properties?tab=lists");
    const assigned = k.getByRole("region", { name: "Assigned to you" });
    await expect(assigned.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await expect(assigned.getByRole("link", { name: new RegExp(name) })).toContainText("3");
    const wl = await (await k.request.get("/app/lists/working")).json();
    const fromList = (wl.stops as { propertyId: string; listName: string | null }[]).filter((s) => s.listName === name).map((s) => s.propertyId);
    expect(fromList.sort()).toEqual(props.map((p) => p.id).sort());
    await ctx.close();
  });

});

test.describe("Tyler (FOX manager)", () => {
  as("tyler");

  test("multi-select rows → Add to list (new list) → Mark active", async ({ page }) => {
    const city = `Sel${uniqueWord(2)}`;
    const acct = await fxAccount({ owner: "tyler", city });
    await Promise.all([1, 2].map((i) => fxProperty({ accountId: acct.id, city, name: `${city} Court ${i}` })));
    await page.goto(`/app/properties?tab=all&city=${city}`);
    await page.getByRole("link", { name: "Select" }).click();
    await page.waitForURL(/select=1/);
    await page.getByRole("toolbar", { name: "Selected properties" }).getByRole("button", { name: /^Select all/ }).click();
    await expect(page.getByRole("toolbar", { name: "Selected properties" })).toContainText("2 selected");
    await page.getByRole("toolbar", { name: "Selected properties" }).getByRole("button", { name: "Add to list" }).click();
    const dlg = page.locator("dialog[open]");
    await dlg.getByLabel("New list").fill(`${city} walk`);
    await dlg.getByRole("button", { name: "Create list and add" }).click();
    await expect(toasts(page)).toContainText(`Saved “${city} walk” · 2 properties`);
    const { data: l } = await db.from("list").select("id,kind").eq("name", `${city} walk`).single();
    expect(l?.kind).toBe("static");
    const { count } = await db.from("list_item").select("property_id", { count: "exact", head: true }).eq("list_id", l!.id);
    expect(count).toBe(2);
  });
});

/** Read the count chip of a built-in list on the Lists tab. */
async function shownCount(page: Page, name: string): Promise<number> {
  const link = page.getByRole("region", { name: "Built-in" }).getByRole("link", { name: new RegExp(name.replace(/[()]/g, "\\$&")) });
  const txt = (await link.locator(".num").last().textContent()) ?? "";
  return Number(txt.replace(/\D/g, ""));
}

test.describe("Morgan (TSG rep): built-in lists", () => {
  as("tsgrep");

  test("system lists show correct counts on seeded data", async ({ page }) => {
    const tsg = await tenantId("tsg");
    // Give a few lists something to find: a leaking building with a warranty ending soon.
    const { data: p } = await db
      .from("property")
      .insert({ tenant_id: tsg, name: `${uniqueWord(2)} Leak House`, address1: "77 Union Ave", city: "Memphis", state: "TN", roof_install_year: 1996, warranty_expires_on: dayOffset(90), source: "rep" })
      .select("id")
      .single();
    await db.from("property_flag").insert({ tenant_id: tsg, property_id: p!.id, flag: "active_leak" });

    const today = dayOffset(0);
    const expected = async () => {
      const base = () => db.from("property_current").select("id,roof_install_year", { count: "exact" }).eq("tenant_id", tsg).is("duplicate_of", null).eq("is_test", false);
      const [all, warranty, leaks, mgmt, storm, touches] = await Promise.all([
        base().limit(1000),
        base().gte("warranty_expires_on", today).lte("warranty_expires_on", dayOffset(365)),
        base().overlaps("active_flags", ["active_leak", "hail_damage", "wind_damage", "ponding", "membrane_damage", "flashing_issue", "drainage_issue", "safety_hazard"]),
        base().gte("management_changed_on", dayOffset(-90)),
        base().not("storm_kind", "is", null),
        db.from("touch").select("property_id,occurred_at").eq("tenant_id", tsg).not("property_id", "is", null).is("voided_at", null).limit(5000),
      ]);
      const last = new Map<string, number>();
      for (const t of touches.data ?? []) last.set(t.property_id!, Math.max(last.get(t.property_id!) ?? 0, Date.parse(t.occurred_at)));
      const rows = all.data ?? [];
      const sixty = Date.now() - 61 * 86_400_000; // loadProperties: whole days since the last touch > 60
      return {
        "Warranty ending in 12 months": warranty.count ?? 0,
        "Open leaks & damage": leaks.count ?? 0,
        "New management (90 days)": mgmt.count ?? 0,
        "Storm hit (30 days)": storm.count ?? 0,
        "Never touched": rows.filter((r) => !last.has(r.id!)).length,
        "Oldest roofs · quiet 60 days": rows.filter((r) => r.roof_install_year != null && (last.get(r.id!) ?? 0) < sixty).length,
      };
    };

    // Other specs add TSG data while this runs: compare against the database at the moment the page renders.
    let seen: Record<string, number> = {};
    let want: Record<string, number> = {};
    for (let attempt = 0; attempt < 4; attempt++) {
      want = await expected();
      await page.goto("/app/properties?tab=lists");
      await expect(page.getByRole("region", { name: "Built-in" }).getByRole("link")).toHaveCount(6);
      seen = {};
      for (const k of Object.keys(want)) seen[k] = await shownCount(page, k);
      if (JSON.stringify(seen) === JSON.stringify(want)) break;
    }
    expect(seen).toEqual(want);
    expect(want["Open leaks & damage"]).toBeGreaterThanOrEqual(1);
    expect(want["Warranty ending in 12 months"]).toBeGreaterThanOrEqual(1);
    expect(want["Never touched"]).toBeGreaterThanOrEqual(1);

    // Opening one shows the same buildings the Properties filter does.
    await page.getByRole("region", { name: "Built-in" }).getByRole("link", { name: /Open leaks & damage/ }).click();
    await expect(page.getByRole("list", { name: "List properties" })).toContainText("Leak House");
    await page.getByRole("link", { name: /Leaks & damage/ }).click();
    await page.waitForURL(/cond=damage/);
    await expect(page.locator("main li").filter({ hasText: "Leak House" })).toBeVisible();
  });
});
