import { db, eventually, fxApproval } from "./support/db";
import { as, expect, test, toasts } from "./support/ui";

test.describe("Tyler (manager)", () => {
  as("tyler");

  test("Team home: pace card shows today's team touches; cards link to drill-ins", async ({ page }) => {
    await page.goto("/app/team");
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    const pace = page.locator("section").filter({ has: page.getByRole("heading", { name: "Pace" }) });
    const big = Number((await pace.locator(".text-4xl").textContent())?.trim());
    expect(big).toBeGreaterThan(0);
    await expect(pace.getByText(/Kayla Smiley/)).toBeVisible();
    // Weekly points are non-zero for someone.
    const pts = (await pace.locator("li span.w-12").allTextContents()).map(Number);
    expect(Math.max(...pts)).toBeGreaterThan(0);

    const cold = page.locator("section").filter({ has: page.getByRole("heading", { name: "Cold P1 / P2" }) });
    expect(Number(await cold.locator(".text-4xl").textContent())).toBeGreaterThan(0);
    const stalled = page.locator("section").filter({ has: page.getByRole("heading", { name: "Stalled opportunities" }) });
    await expect(stalled).toContainText("Lincoln — Preston Hollow Bldg 4 TPO re-roof");
  });

  test("Pace drill-in lists every rep with numbers", async ({ page }) => {
    await page.goto("/app/team/pace");
    await expect(page.getByRole("heading", { level: 1, name: "Pace" })).toBeVisible();
    const kayla = page.getByRole("row").filter({ hasText: "Kayla Smiley" });
    await expect(kayla).toBeVisible();
    const cells = await kayla.getByRole("cell").allTextContents();
    expect(Number(cells[1])).toBeGreaterThan(0); // touches today
    expect(Number(cells[2])).toBeGreaterThan(0); // touches this week
  });

  test("Cold drill-in lists priority accounts past threshold", async ({ page }) => {
    await page.goto("/app/team");
    await page.getByRole("link", { name: /Cold P1 \/ P2/ }).click();
    await page.waitForURL("**/app/team/cold");
    await expect(page.getByRole("heading", { level: 1, name: "Cold P1 / P2" })).toBeVisible();
    // Kayla's / Tyler's cold accounts (Colby's get touched by the Go specs).
    await expect(page.getByRole("row").filter({ hasText: "Bell Partners" })).toContainText("Kayla Smiley");
    await expect(page.getByRole("row").filter({ hasText: "JLL" })).toContainText("Tyler Fox");
  });

  test("Stalled drill-in explains why", async ({ page }) => {
    await page.goto("/app/team/stalled");
    const row = page.getByRole("row").filter({ hasText: "Lincoln — Preston Hollow Bldg 4 TPO re-roof" });
    await expect(row).toContainText("53d in stage");
    await expect(row).toContainText("$160K");
    await expect(row).toContainText("Colby Remedios");
  });

  test("Activity feed filters by rep and channel", async ({ page }) => {
    await page.goto("/app/team/activity");
    await expect(page.getByRole("heading", { level: 1, name: "Activity" })).toBeVisible();
    await page.getByRole("combobox", { name: "Rep" }).selectOption({ label: "Kayla Smiley" });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/rep=/);
    const items = page.locator("main ol > li");
    await expect(items.first()).toBeVisible();
    for (const t of await items.allTextContents()) expect(t).toContain("Kayla Smiley");

    await page.getByRole("combobox", { name: "Channel" }).selectOption({ label: "Call" });
    await page.getByRole("button", { name: "Filter" }).click();
    await expect(page).toHaveURL(/channel=call/);
    for (const t of await items.allTextContents()) {
      expect(t).toContain("Kayla Smiley");
      expect(t.startsWith("Call")).toBe(true);
    }
  });

  test("approvals: a manager can approve G1 but has no approve button for G6", async ({ page }) => {
    const g1 = await fxApproval({ gate: "G1" });
    const g6 = await fxApproval({ gate: "G6" });
    await page.goto("/app/approvals");
    const g1Item = page.locator("main li").filter({ hasText: g1.summary });
    const g6Item = page.locator("main li").filter({ hasText: g6.summary });
    await expect(g1Item.getByText("G1 · Outbound message")).toBeVisible();
    await expect(g6Item.getByText("G6 · Spend")).toBeVisible();
    await expect(g6Item.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(g6Item.getByText("Needs an owner or admin to decide.")).toBeVisible();

    await g1Item.getByRole("button", { name: "Approve" }).click();
    const data = await eventually(async () => (await db.from("approval").select("status").eq("id", g1.id).single()).data, (d) => d?.status === "approved");
    expect(data?.status).toBe("approved");
    await expect(page.getByText(g1.summary)).toHaveCount(0);
  });

  // Regression: BUGS.md#b4
  test("approving confirms with a toast", async ({ page }) => {
    const g1 = await fxApproval({ gate: "G1" });
    await page.goto("/app/approvals");
    await page.locator("main li").filter({ hasText: g1.summary }).getByRole("button", { name: "Approve" }).click();
    await expect(toasts(page)).toContainText("Approved");
  });

  test("a rep-visible Team tab is replaced by Me for reps; managers see Team", async ({ page }) => {
    await page.goto("/app/today");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Team" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Me" })).toHaveCount(0);
  });
});

test.describe("Parks (admin)", () => {
  as("parks");

  test("an admin can approve a G6 spend approval", async ({ page }) => {
    const g6 = await fxApproval({ gate: "G6" });
    await page.goto("/app/approvals");
    const item = page.locator("main li").filter({ hasText: g6.summary });
    await item.getByRole("button", { name: "Approve" }).click();
    const data = await eventually(async () => (await db.from("approval").select("status").eq("id", g6.id).single()).data, (d) => d?.status === "approved");
    expect(data?.status).toBe("approved");
  });

  test("rejecting needs a reason", async ({ page }) => {
    const g1 = await fxApproval({ gate: "G1" });
    await page.goto("/app/approvals");
    const item = page.locator("main li").filter({ hasText: g1.summary });
    await item.getByRole("button", { name: "Reject" }).click();
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(item.locator("p[role=alert]")).toContainText("Say why");
    const why = item.getByPlaceholder(/Wrong contact/);
    await expect(async () => {
      await why.fill("Wrong contact — Dave left in June");
      await expect(why).toHaveValue("Wrong contact — Dave left in June", { timeout: 1000 });
    }).toPass();
    await item.getByRole("button", { name: "Reject" }).click();
    const data = await eventually(async () => (await db.from("approval").select("status,note").eq("id", g1.id).single()).data, (d) => d?.status === "rejected");
    expect(data).toMatchObject({ status: "rejected", note: "Wrong contact — Dave left in June" });
  });
});

test.describe("Colby (rep) can't open manager screens", () => {
  as("colby");
  test("Team routes send a rep to Me", async ({ page }) => {
    for (const p of ["/app/team", "/app/team/pace", "/app/team/activity"]) {
      await page.goto(p);
      await expect(page).toHaveURL(/\/app\/me$/);
    }
  });
});
