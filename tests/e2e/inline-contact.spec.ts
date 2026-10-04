import { eventually, fxAccount, touchesForContact, db, uniqueWord } from "./support/db";
import { as, expect, sheet, tap, test, tile, toasts } from "./support/ui";

as("colby");

test("adding someone who already exists asks 'Is this them?' and reuses the existing contact", async ({ page }) => {
  await page.goto("/app/today");
  await tap(page, page.getByRole("button", { name: "Log a touch" }));
  const s = sheet(page);
  await tap(page, s.getByRole("button", { name: "New contact" }));
  await s.getByLabel("Name").fill("Dana Whitfield");
  await s.getByLabel("Title").fill("RVP");
  await tap(page, s.getByRole("button", { name: "Add contact" }));

  await expect(s.getByText("Is this them?")).toBeVisible();
  const match = s.getByRole("button", { name: /Dana Whitfield.*Greystar/ });
  await expect(match).toBeVisible();
  await tap(page, match);

  // The sheet now targets the existing Dana at Greystar — no duplicate was created.
  await expect(s.getByRole("button", { name: /^Dana Whitfield/ })).toBeVisible();
  await expect(s.locator("#log-sheet-title")).toHaveText("Greystar");
  const { count } = await db.from("contact").select("id", { count: "exact", head: true }).eq("full_name", "Dana Whitfield");
  expect(count).toBe(1);
});

test("'No — add …' creates the new person, who is immediately loggable", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const last = uniqueWord(3);
  await page.goto(`/app/accounts/${acct.id}`);
  await tap(page, page.getByRole("button", { name: "Log on this account" }));
  const s = sheet(page);
  await expect(s.getByText(`${acct.name} (no contact)`)).toBeVisible();
  await tap(page, s.getByRole("button", { name: /Change$/ }));
  await tap(page, s.getByRole("button", { name: "New contact" }));
  await s.getByLabel("Name").fill(`Marcus ${last}`);
  await s.getByLabel("Role").selectOption({ label: "Decision maker" });
  await tap(page, s.getByRole("button", { name: "Add contact" }));
  // "Marcus Okafor" is seeded: a first-name-only overlap must not block a clearly different person… but if the
  // similarity check does fire, the rep can still add them.
  const noBtn = s.getByRole("button", { name: `No — add Marcus ${last}` });
  if (await noBtn.isVisible().catch(() => false)) await tap(page, noBtn);
  await expect(s.getByRole("button", { name: new RegExp(`^Marcus ${last}`) })).toBeVisible();
  await tap(page, tile(s, "Site visit"));
  await tap(page, tile(s, "Met in person"));
  await expect(toasts(page)).toContainText(/^\+\d+/);

  const { data: c } = await db.from("contact").select("id,account_id,source").eq("full_name", `Marcus ${last}`).single();
  expect(c?.account_id).toBe(acct.id);
  const touches = await eventually(() => touchesForContact(c!.id), (t) => t.length === 1);
  expect(touches).toHaveLength(1);
});
