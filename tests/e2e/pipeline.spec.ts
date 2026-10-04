import { db, eventually, fxAccount, fxOpportunity, uniqueWord } from "./support/db";
import { as, expect, formAlert, test } from "./support/ui";

as("colby");

test("the 53-day $160K proposal is flagged Stalled on the board and on its page", async ({ page }) => {
  await page.goto("/app/pipeline?scope=mine");
  await expect(page.getByRole("heading", { level: 1, name: "Pipeline" })).toBeVisible();
  const card = page.getByRole("link", { name: /Lincoln — Preston Hollow Bldg 4 TPO re-roof/ }).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText("$160K");
  await expect(card).toContainText("53d in stage");
  await expect(card.getByText("Stalled")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Proposal sent · \d+\s*1 stalled/ })).toBeVisible();

  await card.click();
  await page.waitForURL(/\/app\/pipeline\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lincoln — Preston Hollow Bldg 4 TPO re-roof");
  await expect(page.getByText("Stalled", { exact: true })).toBeVisible();
  await expect(page.getByText("53d", { exact: true })).toBeVisible();
});

test("creating an opportunity requires a next step", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const name = `${uniqueWord(2)} bldg 2 repairs`;
  await page.goto(`/app/pipeline/new?account=${acct.id}`);
  await page.getByLabel(/Job name/).fill(name);
  await page.getByLabel("Stage").selectOption({ label: "Contacted" });
  await page.getByLabel("Value $").fill("38500");
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await expect(formAlert(page)).toContainText("Open jobs need a next step and a date");
  const { count } = await db.from("opportunity").select("id", { count: "exact", head: true }).eq("name", name);
  expect(count).toBe(0);

  await page.getByLabel("Next step", { exact: true }).fill("Walk bldg 2 with the PM");
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await page.waitForURL(/\/app\/pipeline\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Contacted").first()).toBeVisible();
  await expect(page.getByText("$39K")).toBeVisible();

  // It shows up on the account and creates a next-step task.
  const { data: o } = await db.from("opportunity").select("id").eq("name", name).single();
  const { data: tasks } = await db.from("task").select("kind,title,status").eq("opportunity_id", o!.id);
  expect(tasks).toEqual([expect.objectContaining({ kind: "next_step", title: "Walk bldg 2 with the PM", status: "open" })]);
});

test("moving an opportunity through stages", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const opp = await fxOpportunity({ accountId: acct.id, stage: "inspection_complete" });
  await page.goto(`/app/pipeline/${opp.id}`);
  await page.getByLabel("Stage").selectOption({ label: "Proposal sent" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator('[role="status"][aria-live="polite"]:not([aria-busy])').last()).toContainText("Saved · Proposal sent");
  await expect(page.locator("main header").getByText("Proposal sent")).toBeVisible();
  await expect(page.getByText("0d", { exact: true })).toBeVisible();
  const { data } = await db.from("point_event").select("event,points").eq("opportunity_id", opp.id);
  expect(data).toEqual([expect.objectContaining({ event: "proposal_delivered", points: 20 })]);

  await page.getByLabel("Stage").selectOption({ label: "Negotiation" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("main header").getByText("Negotiation")).toBeVisible();
  expect((await db.from("opportunity").select("stage").eq("id", opp.id).single()).data?.stage).toBe("negotiation");
});

test("marking lost requires a reason; the reason is shown", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const opp = await fxOpportunity({ accountId: acct.id, stage: "proposal_sent" });
  await page.goto(`/app/pipeline/${opp.id}`);
  await page.getByRole("button", { name: "Mark lost" }).click();
  await expect(page.getByLabel(/Why was it lost/)).toHaveJSProperty("validity.valueMissing", true);
  expect((await db.from("opportunity").select("stage").eq("id", opp.id).single()).data?.stage).toBe("proposal_sent");

  await page.getByLabel(/Why was it lost/).fill("Went with low bid");
  await page.getByRole("button", { name: "Mark lost" }).click();
  await eventually(async () => (await db.from("opportunity").select("stage").eq("id", opp.id).single()).data?.stage, (s) => s === "lost");
  await page.reload();
  await expect(page.getByText(/Lost .* — Went with low bid/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark lost" })).toHaveCount(0);
});

// Regression: BUGS.md#b4 — the toast must show even though the Won/Lost forms unmount on success.
test("marking won confirms with a toast", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const opp = await fxOpportunity({ accountId: acct.id, stage: "negotiation" });
  await page.goto(`/app/pipeline/${opp.id}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Mark won" }).click();
  await expect(page.locator('[role="status"][aria-live="polite"]:not([aria-busy])').last()).toContainText("Marked won");
});

test("marking won (with confirm) closes it out", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const opp = await fxOpportunity({ accountId: acct.id, stage: "negotiation" });
  await page.goto(`/app/pipeline/${opp.id}`);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Mark won" }).click();
  await eventually(async () => (await db.from("opportunity").select("stage").eq("id", opp.id).single()).data?.stage, (s) => s === "won");
  await page.reload();
  await expect(page.getByText(/^Won /)).toBeVisible();
  const { data } = await db.from("point_event").select("event,points").eq("opportunity_id", opp.id).eq("event", "won");
  expect(data?.[0]?.points).toBe(50);
  // Gone from the open board.
  await page.goto("/app/pipeline?scope=mine");
  await expect(page.getByRole("link", { name: new RegExp(opp.name) })).toHaveCount(0);
});
