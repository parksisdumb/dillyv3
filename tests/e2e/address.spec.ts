// Address suggestions while typing. The app runs with DILLY_ADDRESS_PROVIDER=fake (playwright.config.ts): deterministic
// Memphis / Austin suggestions from src/lib/geo/suggest/fake.ts, no network.
import { db, eventually, tenantId, uniqueWord } from "./support/db";
import { as, expect, formAlert, tap, test } from "./support/ui";

as("colby");

const PLEMONS = "1801 S Plemons St";

test.describe("Address autocomplete", () => {
  test("type → pick → city/state/zip filled → saved with a pin; the same pick again warns about the duplicate", async ({ page }) => {
    const fox = await tenantId("fox");
    await db.from("property").delete().eq("tenant_id", fox).eq("address1", PLEMONS);
    const outside: string[] = [];
    page.on("request", (r) => {
      if (/komoot|googleapis/.test(r.url())) outside.push(r.url());
    });

    await page.goto("/app/properties/new");
    const address = page.getByRole("combobox", { name: "Address", exact: true });
    await address.click();
    await address.pressSequentially("1801 S Ple", { delay: 30 });
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list).toBeVisible();
    const options = list.getByRole("option"); // (the form's <select>s have options too)
    await expect(address).toHaveAttribute("aria-expanded", "true");
    await expect(options).toHaveCount(3); // 2 suggestions + "Use what I typed"
    await expect(options.last()).toContainText("Use what I typed");
    // 48 px rows, one thumb.
    const box = await options.first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(48);

    await tap(page, page.getByRole("option", { name: /1801 S Plemons St, Memphis/ }));
    await expect(list).toBeHidden();
    await expect(address).toHaveValue(PLEMONS);
    await expect(page.getByLabel("City")).toHaveValue("Memphis");
    await expect(page.getByLabel("State")).toHaveValue("TN");
    await expect(page.getByLabel("Zip")).toHaveValue("38106");

    await page.getByLabel("Property name").fill(`${uniqueWord(2)} Lofts`);
    await page.getByRole("button", { name: "Add property" }).click();
    await page.waitForURL(/\/app\/properties\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    const row = await eventually(
      async () => (await db.from("property").select("address1,city,state,zip,lat,lng,geocoded_at,geocode_source").eq("id", id).single()).data,
      (r) => !!r,
    );
    expect(row).toMatchObject({ address1: PLEMONS, city: "Memphis", state: "TN", zip: "38106", geocode_source: "photon" });
    expect(Number(row!.lat)).toBeCloseTo(35.106221, 5);
    expect(Number(row!.lng)).toBeCloseTo(-90.031874, 5);
    expect(row!.geocoded_at).toBeTruthy();

    // Picking the same building again: the duplicate check still runs on save.
    await page.goto("/app/properties/new");
    await address.click();
    await address.pressSequentially("1801 S Plem", { delay: 30 });
    await tap(page, page.getByRole("option", { name: /1801 S Plemons St, Memphis/ }));
    await expect(page.getByLabel("City")).toHaveValue("Memphis");
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(formAlert(page)).toContainText("is already at that address");

    expect(outside).toEqual([]); // providers are only ever called by the server
  });

  test("“Use what I typed” keeps the text and saves without an autocomplete pin", async ({ page }) => {
    const street = `1801 ${uniqueWord(2)} Ln`;
    await page.goto("/app/properties/new");
    const address = page.getByRole("combobox", { name: "Address", exact: true });
    await address.click();
    await address.pressSequentially(street, { delay: 20 });
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
    await tap(page, page.getByRole("option", { name: /Use what I typed/ }));
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden();
    await expect(address).toHaveValue(street);
    await expect(page.getByLabel("City")).toHaveValue("");
    await page.getByLabel("City").fill("Memphis");
    await page.getByLabel("State").fill("TN");
    await page.getByRole("button", { name: "Add property" }).click();
    await page.waitForURL(/\/app\/properties\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    const { data: row } = await db.from("property").select("address1,city,lat,geocode_source").eq("id", id).single();
    expect(row!.address1).toBe(street);
    expect(row!.city).toBe("Memphis");
    expect(["google", "photon"]).not.toContain(row!.geocode_source); // left to the Census geocoder
  });

  test("keyboard: ↓ + Enter picks without submitting; Escape closes (account form)", async ({ page }) => {
    await page.goto("/app/accounts/new");
    const address = page.getByRole("combobox", { name: "Office address" });
    await address.click();
    await address.pressSequentially("500 E Ces", { delay: 30 });
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
    await address.press("Escape");
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeHidden();
    await expect(address).toHaveValue("500 E Ces");
    await address.press("ArrowDown"); // reopen
    await expect(page.getByRole("listbox", { name: "Suggestions" })).toBeVisible();
    await address.press("ArrowDown");
    await expect(address).toHaveAttribute("aria-activedescendant", /.+/);
    await address.press("Enter");
    await expect(address).toHaveValue("500 E Cesar Chavez St");
    await expect(page.getByLabel("City")).toHaveValue("Austin");
    await expect(page.getByLabel("Zip")).toHaveValue("78701");
    await expect(page).toHaveURL(/\/app\/accounts\/new$/); // Enter picked; it didn't submit
  });
});
