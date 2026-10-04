/**
 * Saves made through ActionForm (src/components/ui/action-form.tsx) must update the screen in place. Reproduces
 * BUGS.md#b1: the server action succeeds (row written, 200 response) but ~half the time the form stays on "Saving…"
 * and the page never refreshes until a manual reload.
 */
import { db, eventually, fxAccount, fxContact, tenantId, uniqueWord } from "./support/db";
import { as, expect, test } from "./support/ui";

as("colby");

// Known bug: BUGS.md#b1
test.fixme("linking a contact to a property updates the page without a reload (5 tries)", async ({ page }) => {
  test.setTimeout(180_000);
  for (let i = 0; i < 5; i++) {
    const acct = await fxAccount({ owner: "colby" });
    const c = await fxContact({ accountId: acct.id });
    const { data: prop } = await db
      .from("property")
      .insert({ tenant_id: await tenantId("fox"), account_id: acct.id, name: `${uniqueWord(2)} Flats`, address1: "1 Test Way", city: "Austin" })
      .select("id")
      .single();
    await page.goto(`/app/properties/${prop!.id}`);
    await page.getByText("+ Link a contact").click();
    await page.getByPlaceholder("Name or email").fill(c.full_name.split(" ")[1]!);
    await page.getByRole("button", { name: new RegExp(c.full_name) }).click();
    await page.getByRole("button", { name: "Link contact" }).click();
    await eventually(async () => (await db.from("property_contact").select("contact_id").eq("property_id", prop!.id)).data ?? [], (r) => r.length === 1);
    await expect(page.getByRole("heading", { name: "People at this building · 1" }), `try ${i + 1}`).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Saving…" })).toHaveCount(0);
  }
});
