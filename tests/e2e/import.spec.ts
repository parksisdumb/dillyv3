/**
 * CSV import (TSG launches with no data, so this is day-one critical): upload the Memphis sample, see duplicates and
 * errors flagged, commit, see new accounts assigned, undo. Parks (team@dillyos.com) is the TSG owner.
 */
import path from "node:path";
import { db, eventually, tenantId, userId } from "./support/db";
import { as, expect, test, toasts } from "./support/ui";

const SAMPLE = path.resolve(__dirname, "../../docs/samples/tsg-import-sample.csv");

async function importedAccounts(tsg: string) {
  const { data } = await db.from("account").select("id,name,owner_user_id,source,import_batch_id").eq("tenant_id", tsg).not("import_batch_id", "is", null);
  return data ?? [];
}

test.describe("Parks (TSG owner) imports a spreadsheet", () => {
  as("team");

  test.beforeAll(async () => {
    const tsg = await tenantId("tsg");
    // Leftovers from an interrupted earlier run would show up as "matched" instead of new.
    for (const t of ["property_contact", "property", "contact", "account"] as const) {
      const { error } = await db.from(t).delete().eq("tenant_id", tsg).not("import_batch_id", "is", null);
      if (error) throw new Error(`cleanup ${t}: ${error.message}`);
    }
    // One company from the sheet already exists in TSG → it must be flagged as a match, not duplicated.
    const { data } = await db.from("account").select("id").eq("tenant_id", tsg).eq("name", "Wolf River Commercial");
    if (!data?.length) await db.from("account").insert({ tenant_id: tsg, name: "Wolf River Commercial", account_type: "property_mgmt", source: "rep" });
  });

  test("upload → map → preview with duplicates and errors → commit → assigned → undo", async ({ page }) => {
    const tsg = await tenantId("tsg");
    const parks = await userId("team");
    const morgan = await userId("tsgrep");

    await page.goto("/app/accounts?scope=all");
    await page.getByRole("link", { name: "Import", exact: true }).click();
    await page.waitForURL("**/app/import**");
    await expect(page.getByRole("heading", { level: 1, name: "Import" })).toBeVisible();

    await page.getByLabel("CSV file").setInputFiles(SAMPLE);
    // Map step: headers auto-detected.
    await expect(page.getByText("tsg-import-sample.csv")).toBeVisible();
    await expect(page.getByText(/42 rows · 17 columns · 17 mapped/)).toBeVisible();
    await expect(page.getByLabel("Import “Management Company” as")).toHaveValue("account_name");
    await expect(page.getByLabel("Import “Rep Email” as")).toHaveValue("rep_email");
    await page.getByRole("button", { name: "Preview import" }).click();

    // Preview: nothing written yet; Wolf River matched; in-sheet repeats merged; bad email flagged.
    await expect(page.getByRole("tab", { name: /Companies/ })).toBeVisible();
    expect(await importedAccounts(tsg)).toHaveLength(0);
    const wolf = page.locator("li").filter({ hasText: "Wolf River Commercial" }).first();
    await expect(wolf).toContainText("Matches existing");
    await expect(wolf.getByRole("radio", { name: "Link" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText(/2 with errors/)).toBeVisible();
    await expect(page.getByText(/3 repeats/)).toBeVisible();

    // Rows without a rep go to Morgan; rows with team@dillyos.com go to Parks.
    await page.getByLabel("Rows without a rep go to").selectOption({ label: "Morgan Hale" });
    await expect(page.getByTestId("owner-tally")).toContainText("Morgan Hale");
    await expect(page.getByTestId("owner-tally")).toContainText("Parks Flowers");

    await page.getByRole("tab", { name: /Issues/ }).click();
    await expect(page.getByText(/Bad email “shauna\.booker@example”/)).toBeVisible();
    await expect(page.getByText(/Roof details but no property/)).toBeVisible();

    await page.getByRole("button", { name: /^Import \d+ rows$/ }).click();
    await expect(page.getByRole("heading", { name: "Imported" })).toBeVisible({ timeout: 60_000 });

    const accts = await eventually(() => importedAccounts(tsg), (r) => r.length >= 10);
    const owner = (n: string) => accts.find((a) => a.name === n)?.owner_user_id;
    expect(accts.map((a) => a.name)).not.toContain("Wolf River Commercial");
    expect(accts.every((a) => a.source === "import")).toBe(true);
    expect(owner("Riverbend Property Partners")).toBe(parks);
    expect(owner("Chickasaw Bluff Properties")).toBe(morgan);
    // Property rows got their current manager history row.
    const { data: party } = await db
      .from("property_current")
      .select("name,current_manager_name")
      .eq("tenant_id", tsg)
      .eq("name", "Harbor Town Commons")
      .single();
    expect(party?.current_manager_name).toBe("Riverbend Property Partners");
    // The repeated Overton Flats row didn't create a second building.
    const { data: overton } = await db.from("property").select("id").eq("tenant_id", tsg).eq("name", "Overton Flats");
    expect(overton).toHaveLength(1);

    // New accounts are visible to the team, assigned.
    await page.goto("/app/accounts?scope=all&q=Chickasaw");
    await expect(page.getByRole("link", { name: /Chickasaw Bluff Properties/ })).toBeVisible();

    // Undo from Recent imports.
    await page.goto("/app/import");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Undo import tsg-import-sample.csv" }).first().click();
    await expect(toasts(page)).toContainText(/Import undone|Undone/);
    await eventually(() => importedAccounts(tsg), (r) => r.length === 0);
    expect(await importedAccounts(tsg)).toHaveLength(0);
    const { data: still } = await db.from("account").select("id").eq("tenant_id", tsg).eq("name", "Wolf River Commercial");
    expect(still).toHaveLength(1);
  });
});

test.describe("reps can't import", () => {
  as("tsgrep");

  test("/app/import is a 404 and Accounts has no Select / Import controls", async ({ page }) => {
    const res = await page.goto("/app/import");
    expect(res?.status()).toBe(404);
    await page.goto("/app/accounts?scope=all");
    await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Select" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import", exact: true })).toHaveCount(0);
  });
});
