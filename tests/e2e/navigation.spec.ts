/**
 * Soft navigation must always land. Regression test for BUGS.md#b9: with route-level loading.tsx boundaries, a
 * same-screen navigation (filters, "Everyone's", search) intermittently never committed (~1 in 4). Skeletons now
 * live in each page's own <Suspense>.
 */
import { as, expect, test } from "./support/ui";

as("colby");

test("same-route navigation (Mine → Everyone's) commits every time (12 tries)", async ({ page }) => {
  test.setTimeout(180_000);
  for (let i = 0; i < 12; i++) {
    await page.goto("/app/contacts?q=" + encodeURIComponent("Dana Whitfield") + "&scope=mine&show=never");
    await page.waitForLoadState("networkidle");
    await page.getByRole("group", { name: "Filters" }).getByRole("link", { name: "All" }).click();
    await expect(page, `try ${i + 1}`).toHaveURL(/scope=mine(?!.*show=never)/, { timeout: 8_000 });
  }
});
