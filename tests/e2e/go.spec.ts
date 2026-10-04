import { db, eventually, pointsFor, touchesForAccount, uniqueWord } from "./support/db";
import { as, expect, sheet, tap, test, toasts } from "./support/ui";

as("colby");

test.describe("Go — field session", () => {
  test("logging a disposition records a field touch and advances to the next stop", async ({ page }) => {
    await page.goto("/app/go?city=Austin");
    await expect(page.getByRole("heading", { level: 1, name: "Field session" })).toBeVisible();
    // The floating Log button is hidden: Go is itself the logging surface.
    await expect(page.getByRole("button", { name: "Log a touch" })).toHaveCount(0);

    const stop = page.getByRole("article");
    await expect(stop).toHaveAttribute("aria-label", /^Stop 1 of \d+$/);
    const total = Number((await stop.getAttribute("aria-label"))!.match(/of (\d+)/)![1]);
    test.skip(total < 2, "needs at least two stops in the first city");
    const firstName = (await stop.getByRole("heading", { level: 2 }).textContent())!.trim();
    const { data: acct } = await db.from("account").select("id").eq("name", firstName).limit(1).single();
    const before = (await touchesForAccount(acct!.id)).length;

    await tap(page, stop.getByRole("radio", { name: "Door knock" }));
    await stop.getByLabel("Notes").fill("Office closed, left card");
    await tap(page, page.getByRole("group", { name: "What happened" }).getByRole("button", { name: /^Not there/ }));

    await expect(toasts(page)).toContainText(/Revisit/);
    await expect(page.getByRole("article")).toHaveAttribute("aria-label", "Stop 2 of " + total);
    await expect(page.getByText(/1 logged · \d+ to go/)).toBeVisible();
    await expect(page.getByRole("article").getByRole("heading", { level: 2 })).not.toHaveText(firstName);

    const after = await eventually(() => touchesForAccount(acct!.id), (t) => t.length === before + 1);
    const t = after.find((x) => x.outcome === "not_there");
    expect(t).toMatchObject({ channel: "door_knock", source: "field" });

    // The stop list marks the logged stop.
    await tap(page, page.getByRole("button", { name: /All \d+/ }));
    await expect(page.getByRole("listitem").filter({ hasText: firstName }).getByText("Not there")).toBeVisible();
  });

  test("Add person I met → new field contact (earns field points) and is selected for the disposition", async ({ page }) => {
    const name = `${uniqueWord(2)} ${uniqueWord(2)}`;
    await page.goto("/app/go?city=Austin");
    const stop = page.getByRole("article");
    await tap(page, stop.getByRole("button", { name: "Add person I met" }));
    await stop.getByLabel("Name").fill(name);
    await stop.getByLabel("Title").fill("Chief engineer");
    await tap(page, stop.getByRole("button", { name: "Add person", exact: true }));
    await expect(toasts(page)).toContainText(`Added ${name}`);
    await expect(stop.getByRole("button", { name: new RegExp(name), pressed: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "What happened" })).toContainText(name);

    const { data: c } = await db.from("contact").select("id,source,account_id").eq("full_name", name).single();
    expect(c?.source).toBe("field");
    const pts = await eventually(() => pointsFor("colby", { event: "field_contact_created", accountId: c!.account_id! }), (p) => p.length > 0);
    expect(pts[0]!.points).toBe(4);
  });

  test("Person button opens the standalone 'Add person I met' page", async ({ page }) => {
    await page.goto("/app/go?city=Austin");
    await tap(page, page.getByRole("link", { name: "Person" }));
    await expect(page.getByRole("heading", { level: 1, name: "Add person I met" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/app/go");
  });
});

test.describe("Go — focus (calls) mode", () => {
  test("outcome buttons log the call and move to the next dial", async ({ page }) => {
    await page.goto("/app/go?mode=focus");
    await expect(page.getByRole("heading", { level: 1, name: "Focus session" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Calls", selected: true })).toBeVisible();
    const card = page.getByRole("article");
    await expect(card).toHaveAttribute("aria-label", /^Call 1 of \d+$/);
    await expect(card.getByRole("link", { name: /\(\d{3}\) \d{3}-\d{4}/ })).toHaveAttribute("href", /^tel:/);
    // Every call outcome shows its point value.
    for (const o of ["Connected", "Left voicemail", "No answer", "Gatekeeper", "Call back later", "Booked inspection", "Not interested"]) {
      await expect(card.getByRole("button", { name: new RegExp(`^${o} \\+\\d+$`) })).toBeVisible();
    }
    await tap(page, card.getByRole("button", { name: /^Left voicemail/ }));
    await expect(toasts(page)).toContainText(/next: Call .+ back/);
    await expect(page.getByRole("article")).toHaveAttribute("aria-label", /^Call 2 of \d+$/);
    await expect(page.getByText("Dials").locator("..")).toContainText("1");
    // No stray log sheet.
    await expect(sheet(page)).toHaveCount(0);
  });
});
