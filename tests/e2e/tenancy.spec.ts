import { db, tenantId } from "./support/db";
import { as, expect, test } from "./support/ui";

async function accountIdByName(slug: "fox" | "tsg", name: string) {
  const { data } = await db.from("account").select("id").eq("tenant_id", await tenantId(slug)).eq("name", name).single();
  return data!.id as string;
}

test.describe("Parks (platform admin) works both companies", () => {
  as("parks");

  test("the company switcher lists FOX and TSG, and switching changes the data", async ({ page }) => {
    await page.goto("/app/accounts?scope=all");
    await expect(page.getByRole("link", { name: /Greystar/ })).toBeVisible();

    await page.getByRole("button", { name: /^Company: FOX Roofing\. Switch company/ }).click();
    const sw = page.locator("dialog[open]");
    await expect(sw.getByRole("button", { name: /FOX Roofing/ })).toBeVisible();
    await expect(sw.getByRole("button", { name: /The Service Group/ })).toBeVisible();
    await sw.getByRole("button", { name: /The Service Group/ }).click();

    await page.waitForURL("**/app/today");
    await expect(page.getByRole("button", { name: /^Company: The Service Group/ })).toBeVisible();
    await page.goto("/app/accounts?scope=all");
    await expect(page.getByRole("link", { name: /Mid-America Apartment Communities/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Greystar/ })).toHaveCount(0);
  });
});

test.describe("Colby (FOX rep) is fenced into FOX", () => {
  as("colby");

  test("no company switcher for a single-company rep", async ({ page }) => {
    await page.goto("/app/today");
    await expect(page.getByRole("banner").getByText("FOX Roofing")).toBeVisible();
    await expect(page.getByRole("button", { name: /Switch company/ })).toHaveCount(0);
  });

  test("a TSG account URL is not reachable (404), and TSG names never show up", async ({ page }) => {
    const tsgAcct = await accountIdByName("tsg", "Mid-America Apartment Communities");
    await page.goto(`/app/accounts/${tsgAcct}`);
    await expect(page.getByText("Can't find that one.")).toBeVisible();
    await expect(page.getByText("Mid-America Apartment Communities")).toHaveCount(0);

    await page.goto("/app/search?q=Memphis");
    await expect(page.getByText("Mid-America Apartment Communities")).toHaveCount(0);
    await page.goto("/app/accounts?scope=all&q=mid-america");
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });

  test("forging the tenant cookie to TSG does not open TSG", async ({ page, context }) => {
    await context.addCookies([{ name: "dilly_tenant", value: "tsg", domain: "localhost", path: "/" }]);
    await page.goto("/app/accounts?scope=all");
    await expect(page.getByRole("banner").getByText("FOX Roofing")).toBeVisible();
    await expect(page.getByText("Mid-America Apartment Communities")).toHaveCount(0);
  });
});

test.describe("TSG rep can't see FOX", () => {
  as("tsgrep");

  test("TSG rep sees TSG accounts only; FOX account URLs 404", async ({ page }) => {
    await page.goto("/app/accounts?scope=all");
    await expect(page.getByRole("banner").getByText("The Service Group")).toBeVisible();
    await expect(page.getByRole("link", { name: /Mid-America Apartment Communities/ })).toBeVisible();
    await expect(page.getByText("Greystar")).toHaveCount(0);

    const fox = await accountIdByName("fox", "Greystar");
    await page.goto(`/app/accounts/${fox}`);
    await expect(page.getByText("Can't find that one.")).toBeVisible();
    await expect(page.getByText("Greystar")).toHaveCount(0);

    const { data: opp } = await db.from("opportunity").select("id,name").eq("tenant_id", await tenantId("fox")).limit(1).single();
    await page.goto(`/app/pipeline/${opp!.id}`);
    await expect(page.getByText("Can't find that one.")).toBeVisible();
    await expect(page.getByText(opp!.name)).toHaveCount(0);
  });

  // Regression: BUGS.md#b6 — real 404, decided in [id]/layout.tsx before any streaming.
  test("another company's record answers with HTTP 404 (not a soft 404)", async ({ page }) => {
    const fox = await accountIdByName("fox", "Greystar");
    const res = await page.goto(`/app/accounts/${fox}`);
    expect(res?.status()).toBe(404);
  });
});
