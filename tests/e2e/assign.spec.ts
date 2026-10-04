/** Bulk assign / reassign: Tyler moves three of his accounts to Kayla; their open tasks follow to her Today.
 * (Fixtures belong to Tyler, not Colby, so they never show up in the Colby queue other specs assert on.) */
import { db, eventually, fxAccount, fxTask, uniqueWord, userId } from "./support/db";
import { authFile } from "./support/personas";
import { as, expect, sheet, test, toasts } from "./support/ui";

test.describe("Tyler (manager)", () => {
  as("tyler");

  test("Select → Assign to Kayla moves the accounts and their open tasks; it's logged", async ({ page, browser }) => {
    const w = uniqueWord();
    const accts: { id: string; name: string }[] = [];
    const tasks: { id: string; title: string }[] = [];
    for (const suffix of ["Alpha", "Beta", "Gamma"]) {
      const a = await fxAccount({ owner: "tyler", name: `${w} ${suffix} Holdings`, touchedDaysAgo: 3 });
      accts.push(a);
      tasks.push(await fxTask({ assignee: "tyler", accountId: a.id, title: `Call back ${w} ${suffix}`, due: 0 }));
    }
    await page.goto(`/app/accounts?scope=all&q=${w}`);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: /^Select all 3/ }).click();
    await expect(page.getByRole("toolbar", { name: "Bulk actions" })).toContainText("3 selected");
    await page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Assign" }).click();
    await expect(sheet(page)).toContainText("Tasks a teammate is holding stay with them");
    await sheet(page).getByRole("button", { name: /Kayla Smiley/ }).click();
    await expect(toasts(page)).toContainText("Reassigned 3 accounts · 3 open tasks moved");

    const kayla = await userId("kayla");
    const { data: owners } = await db.from("account").select("owner_user_id").in("id", accts.map((a) => a.id));
    expect(owners?.every((o) => o.owner_user_id === kayla)).toBe(true);
    const moved = await eventually(
      async () => (await db.from("task").select("assignee_user_id").in("id", tasks.map((t) => t.id))).data ?? [],
      (r) => r.every((t) => t.assignee_user_id === kayla),
    );
    expect(moved.every((t) => t.assignee_user_id === kayla)).toBe(true);
    const { data: log } = await db.from("account_change").select("field,changed_by,tasks_moved").in("account_id", accts.map((a) => a.id));
    expect(log).toHaveLength(3);
    const tyler = await userId("tyler");
    expect(log?.every((l) => l.field === "owner" && l.changed_by === tyler && l.tasks_moved === 1)).toBe(true);

    // Kayla's Today shows the tasks.
    const ctx = await browser.newContext({ storageState: authFile("kayla"), viewport: { width: 390, height: 844 } });
    const kp = await ctx.newPage();
    await kp.goto("/app/today");
    for (const t of tasks) await expect(kp.getByText(t.title, { exact: true })).toBeVisible();
    await ctx.close();
  });

  test("Assign on the account page", async ({ page }) => {
    const a = await fxAccount({ owner: "colby", name: `${uniqueWord()} Single Co`, touchedDaysAgo: 2 });
    await page.goto(`/app/accounts/${a.id}`);
    await expect(page.getByRole("main")).toContainText("Owner: Colby Remedios");
    await page.getByRole("button", { name: "Reassign" }).click();
    await sheet(page).getByRole("button", { name: /Kayla Smiley/ }).click();
    await expect(toasts(page)).toContainText("Reassigned 1 account");
    await expect(page.getByRole("main")).toContainText("Owner: Kayla Smiley");
  });
});

test.describe("Colby (rep)", () => {
  as("colby");
  test("no Select button, no Assign on the account page", async ({ page }) => {
    const a = await fxAccount({ owner: "kayla", name: `${uniqueWord()} Rep View Co`, touchedDaysAgo: 2 });
    await page.goto("/app/accounts?scope=all");
    await expect(page.getByRole("heading", { level: 1, name: "Accounts" })).toBeAttached();
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveCount(0);
    await page.goto(`/app/accounts/${a.id}`);
    await expect(page.getByRole("main")).toContainText("Owner: Kayla Smiley");
    await expect(page.getByRole("button", { name: /^(Re)?assign$/ })).toHaveCount(0);
  });
});
