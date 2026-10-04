/**
 * Soft navigation must always land. BUGS.md#b9: with the route-level loading.tsx Suspense boundaries, a client
 * navigation that stays on the same route (filters, "Everyone's", search) intermittently never commits — the RSC
 * response arrives in full but the URL and screen don't change (~25% of tries; 0 of 48 with loading.tsx removed).
 */
import { as, expect, test } from "./support/ui";

as("colby");

// Known bug: BUGS.md#b9 (fix = remove the loading.tsx files; needs the owner's OK — see BUGS.md)
test.fixme("same-route navigation (Mine → Everyone's) commits every time (12 tries)", async ({ page }) => {
  test.setTimeout(180_000);
  for (let i = 0; i < 12; i++) {
    await page.goto("/app/contacts?q=" + encodeURIComponent("Dana Whitfield") + "&scope=mine&show=never");
    await page.waitForLoadState("networkidle");
    await page.getByRole("group", { name: "Filters" }).getByRole("link", { name: "All" }).click();
    await expect(page, `try ${i + 1}`).toHaveURL(/scope=mine(?!.*show=never)/, { timeout: 8_000 });
  }
});
