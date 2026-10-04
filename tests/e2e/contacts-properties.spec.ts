import { db, eventually, fxAccount, fxContact, uniqueWord } from "./support/db";
import { as, expect, formAlert, tap, test } from "./support/ui";

as("colby");

test.describe("Contacts", () => {
  test("search and role filter", async ({ page }) => {
    await page.goto("/app/contacts?scope=all");
    await page.getByRole("searchbox", { name: "Search contacts" }).fill("Dana Whitfield");
    await page.getByRole("searchbox", { name: "Search contacts" }).press("Enter");
    await expect(page.getByRole("link", { name: /^Dana Whitfield/ })).toBeVisible();
    await expect(page.getByText(/^1 contacts?$/)).toBeVisible();

    await page.goto("/app/contacts?scope=all");
    await page.getByRole("combobox", { name: "Persona role" }).selectOption("economic_buyer");
    await page.getByRole("button", { name: "Go", exact: true }).click();
    await expect(page).toHaveURL(/role=economic_buyer/);
    const chips = page.locator("main ul > li a span.label");
    await expect(chips.first()).toBeVisible();
    for (const t of await chips.allTextContents()) expect(t).toBe("Decision maker");
  });

  test("'Mine' only lists people at my accounts", async ({ page }) => {
    await page.goto("/app/contacts");
    await expect(page.getByRole("link", { name: /^Dana Whitfield/ })).toBeVisible(); // Greystar is Colby's
    const { data: cw } = await db.from("account").select("id").eq("name", "Cushman & Wakefield").single();
    const { data: kaylas } = await db.from("contact").select("last_name,full_name").eq("account_id", cw!.id).limit(1).single();
    await page.goto("/app/contacts?q=" + encodeURIComponent(kaylas!.full_name!));
    await expect(page.getByText(/Nobody matches/)).toBeVisible(); // Cushman is Kayla's
    // Follow the empty state's link by URL (a same-route soft navigation can hang: BUGS.md#b9, see navigation.spec.ts).
    await page.goto((await page.getByRole("link", { name: "Look in everyone's contacts" }).getAttribute("href"))!);
    await expect(page.getByRole("link", { name: new RegExp(`^${kaylas!.full_name!}`) })).toBeVisible();
  });

  test("create a standalone contact on an account (via the account picker)", async ({ page }) => {
    const name = `${uniqueWord(2)} ${uniqueWord(2)}`;
    await page.goto("/app/contacts/new");
    await expect(page.getByRole("heading", { level: 1, name: "New contact" })).toBeVisible();
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Title").fill("Facilities Manager");
    await page.getByLabel("Role").selectOption({ label: "Evaluator" });
    await page.getByLabel("Phone").fill("(512) 555-0161");
    await page.getByPlaceholder("Company they work for").fill("RPM");
    await page.getByRole("button", { name: /^RPM Living/ }).click();
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.waitForURL(/\/app\/contacts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("link", { name: "RPM Living" }).first()).toBeVisible();
    await expect(page.getByText("Evaluator").first()).toBeVisible();
  });

  test("contact detail renders tasks, timeline and the edit form", async ({ page }) => {
    const { data: dana } = await db.from("contact").select("id").eq("full_name", "Dana Whitfield").single();
    await page.goto(`/app/contacts/${dana!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Dana Whitfield" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Open tasks · \d+/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save contact" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log with Dana" })).toBeVisible();
  });

  test("editing a contact saves", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const c = await fxContact({ accountId: acct.id });
    await page.goto(`/app/contacts/${c.id}`);
    await page.getByLabel("Title").fill("Director of Operations");
    await page.getByLabel("Mobile").fill("(512) 555-0188");
    await page.getByRole("button", { name: "Save contact" }).click();
    await eventually(async () => (await db.from("contact").select("mobile").eq("id", c.id).single()).data?.mobile, (m) => m === "(512) 555-0188");
    await page.reload();
    await expect(page.getByRole("link", { name: "Call (512) 555-0188" })).toHaveAttribute("href", "tel:(512) 555-0188");
  });
});

test.describe("Properties", () => {
  test("search and roof filter", async ({ page }) => {
    await page.goto("/app/properties");
    await page.getByRole("searchbox", { name: "Search properties" }).fill("Monroe");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("link", { name: /The Monroe/ }).first()).toBeVisible();

    await page.goto("/app/properties");
    await page.getByRole("combobox", { name: "Roof system" }).selectOption("TPO");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/roof=TPO/);
    const rows = page.locator('main ul a[href^="/app/properties/"]');
    await expect(rows.first()).toBeVisible();
    for (const t of await rows.allTextContents()) expect(t).toContain("TPO");
  });

  test("a new property at an existing address warns; a new address creates it", async ({ page }) => {
    await page.goto("/app/properties/new");
    await page.getByLabel("Address", { exact: true }).fill("4801 Burnet Road");
    await page.getByLabel("City").fill("Austin");
    await page.getByRole("button", { name: "Add property" }).click();
    await expect(formAlert(page)).toContainText("is already at that address");

    const street = `${1000 + Math.floor(Math.random() * 8000)} ${uniqueWord(2)} Dr`;
    await page.getByLabel("Property name").fill(`${uniqueWord(2)} Commons`);
    await page.getByLabel("Address", { exact: true }).fill(street);
    await page.getByLabel("Roof system").selectOption("TPO");
    await page.getByLabel("Installed").fill("2006");
    await page.getByRole("button", { name: "Add property" }).click();
    await page.waitForURL(/\/app\/properties\/[0-9a-f-]{36}$/);
    await expect(page.getByText(street).first()).toBeVisible();
  });

  test("link a contact to a property; it shows on both sides", async ({ page }) => {
    const acct = await fxAccount({ owner: "colby" });
    const c = await fxContact({ accountId: acct.id });
    const { data: prop } = await db
      .from("property")
      .insert({ tenant_id: (await db.from("tenant").select("id").eq("slug", "fox").single()).data!.id, account_id: acct.id, name: `${uniqueWord(2)} Flats`, address1: "1 Test Way", city: "Austin" })
      .select("id,name")
      .single();
    await page.goto(`/app/properties/${prop!.id}`);
    await expect(page.getByRole("heading", { name: "People at this building · 0" })).toBeVisible();
    await page.getByText("+ Link a contact").click();
    await page.getByPlaceholder("Name or email").fill(c.full_name.split(" ")[1]!);
    await page.getByRole("button", { name: new RegExp(c.full_name) }).click();
    await page.getByLabel("Role here").fill("Property manager");
    await page.getByRole("button", { name: "Link contact" }).click();
    await eventually(async () => (await db.from("property_contact").select("contact_id").eq("property_id", prop!.id)).data ?? [], (r) => r.length === 1);
    await expect(page.getByRole("heading", { name: "People at this building · 1" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(c.full_name) })).toBeVisible();

    await page.goto(`/app/contacts/${c.id}`);
    await expect(page.getByRole("heading", { name: "Buildings · 1" })).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(prop!.name) })).toBeVisible();
  });

  test("property detail renders roof details and the timeline section", async ({ page }) => {
    await page.goto("/app/properties?q=Monroe");
    await page.getByRole("link", { name: /The Monroe/ }).first().click();
    await page.waitForURL(/\/app\/properties\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("The Monroe");
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Building & roof details" })).toBeVisible();
  });
});

test("Book tabs switch between accounts, contacts and properties", async ({ page }) => {
  await page.goto("/app/accounts");
  const book = page.getByRole("navigation", { name: "Book" });
  await tap(page, book.getByRole("link", { name: "Contacts" }));
  await expect(page).toHaveURL(/\/app\/contacts$/);
  await expect(book.getByRole("link", { name: "Contacts" })).toHaveAttribute("aria-current", "page");
  await tap(page, book.getByRole("link", { name: "Properties" }));
  await expect(page).toHaveURL(/\/app\/properties$/);
});
