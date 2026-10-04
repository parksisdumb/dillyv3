/**
 * Ownership & management ("properties change hands; the building and its history stay"), follow-the-people, and
 * condition flags + badges. Data that matters is checked in the database as well as on screen.
 */
import {
  accountIdByName,
  asUser,
  db,
  eventually,
  fxAccount,
  fxContact,
  fxProperty,
  fxTask,
  fxTouch,
  linkContact,
  tenantId,
  uniqueWord,
  userId,
} from "./support/db";
import { as, expect, sheet, tap, test, toasts } from "./support/ui";

as("colby");

async function pickCompany(scope: import("@playwright/test").Locator, query: string, name: string | RegExp) {
  await scope.getByPlaceholder("Company name").fill(query);
  await scope.getByRole("button", { name: typeof name === "string" ? new RegExp(`^${name}`) : name }).first().click();
}

test("change a property's manager Greystar → RPM: history, people, opportunity and the intro task", async ({ page }) => {
  const greystar = await accountIdByName("fox", "Greystar");
  const rpm = await accountIdByName("fox", "RPM Living");
  const prop = await fxProperty({ accountId: greystar, name: `${uniqueWord(2)} Commons`, roof: "TPO", year: 2009 });
  const onsite = await fxContact({ accountId: greystar, persona: "initiator", title: "Community Manager" });
  const regional = await fxContact({ accountId: greystar, persona: "economic_buyer", title: "Regional Vice President" });
  await linkContact(prop.id, onsite.id, "Community manager");
  await linkContact(prop.id, regional.id, "Regional VP");
  await fxTouch({ accountId: greystar, contactId: onsite.id, propertyId: prop.id, notes: "Ponding at bldg 2" });
  const { data: opp } = await db
    .from("opportunity")
    .insert({
      tenant_id: await tenantId("fox"),
      account_id: greystar,
      property_id: prop.id,
      name: `${prop.name} leak repairs`,
      stage: "inspection_complete",
      value_estimate: 22000,
      next_step: "Send repair quote",
      next_step_due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      owner_user_id: await userId("colby"),
    })
    .select("id")
    .single();

  await page.goto(`/app/properties/${prop.id}`);
  const own = page.getByRole("region", { name: "Ownership and management" });
  await expect(own).toContainText("Greystar");
  await tap(page, own.getByRole("button", { name: "Change management" }));

  const s = sheet(page);
  await expect(s.getByText("Step 1 of 3")).toBeVisible();
  await expect(s.getByText("Manager now: Greystar")).toBeVisible();
  await pickCompany(s, "RPM", "RPM Living");
  await tap(page, s.getByRole("button", { name: "Next" }));

  // Step 2: on-site staff default to "stays with the building", regional stays with Greystar.
  await expect(s.getByText("Step 2 of 3")).toBeVisible();
  await expect(s.getByRole("button", { name: new RegExp(`^${onsite.full_name}: moves to RPM Living`) })).toBeVisible();
  await expect(s.getByRole("button", { name: new RegExp(`^${regional.full_name}: stays with Greystar`) })).toBeVisible();
  await tap(page, s.getByRole("button", { name: "Next" }));

  // Step 3: plain-language summary, then confirm.
  await expect(s.getByText("Step 3 of 3")).toBeVisible();
  await expect(s).toContainText("RPM Living");
  await tap(page, s.getByRole("button", { name: "Confirm" }));
  await expect(toasts(page)).toContainText(`${prop.name}: management is now RPM Living`);
  await expect(sheet(page)).toHaveCount(0);

  // Screen: current manager is RPM, history shows both.
  await expect(own.getByRole("link", { name: "RPM Living" }).first()).toBeVisible();
  await own.getByText(/History · 1 earlier/).click();
  const history = own.locator("ol");
  await expect(history.getByRole("link", { name: "RPM Living" })).toBeVisible();
  await expect(history.getByRole("link", { name: "Greystar" })).toBeVisible();

  // Everything attached to the building stayed: touches, roof facts; the open opportunity followed the manager.
  const { data: p } = await db.from("property").select("account_id,roof_system,roof_install_year").eq("id", prop.id).single();
  expect(p).toMatchObject({ account_id: rpm, roof_system: "TPO", roof_install_year: 2009 });
  const { count: touches } = await db.from("touch").select("id", { count: "exact", head: true }).eq("property_id", prop.id);
  expect(touches).toBe(1);
  const { data: o } = await db.from("opportunity").select("account_id,property_id,stage").eq("id", opp!.id).single();
  expect(o).toMatchObject({ account_id: rpm, property_id: prop.id, stage: "inspection_complete" });
  const { data: parties } = await db.from("property_party").select("account_id,ended_on,source").eq("property_id", prop.id).eq("role", "manager");
  expect(parties).toHaveLength(2);
  expect(parties!.find((r) => r.account_id === greystar)?.ended_on).not.toBeNull();
  expect(parties!.find((r) => r.account_id === rpm)).toMatchObject({ ended_on: null, source: "transfer" });

  // People: on-site contact now works for RPM (and stays linked); regional stays with Greystar, unlinked here.
  const { data: on } = await db.from("contact").select("account_id").eq("id", onsite.id).single();
  const { data: reg } = await db.from("contact").select("account_id").eq("id", regional.id).single();
  expect(on?.account_id).toBe(rpm);
  expect(reg?.account_id).toBe(greystar);
  const { data: links } = await db.from("property_contact").select("contact_id").eq("property_id", prop.id);
  expect(links!.map((l) => l.contact_id)).toEqual([onsite.id]);
  await page.goto(`/app/contacts/${onsite.id}`);
  await expect(page.getByRole("main").getByRole("link", { name: "RPM Living" }).first()).toBeVisible();

  // The intro task goes to RPM's owner (Colby), due next business day, boosted to the top of that day's queue.
  const { data: intro } = await db.from("task").select("id,title,due_on,boost,assignee_user_id,status").eq("property_id", prop.id).like("title", "Intro to new management%").single();
  expect(intro).toMatchObject({ boost: 100, status: "open", assignee_user_id: await userId("colby") });
  const { data: q } = await db.rpc("rep_queue", { p_tenant: await tenantId("fox"), p_user: await userId("colby"), p_day: intro!.due_on });
  // Colby's queue is shared with every spec running in parallel, so "first" means: nothing that isn't itself a boosted
  // door-opener (another test's intro/reconnect) ranks above it — every ordinary follow-up, however overdue, is below.
  const rows = q as { task_id: string | null; score: number }[];
  const at = rows.findIndex((r) => r.task_id === intro!.id);
  expect(at).toBeGreaterThanOrEqual(0);
  const aboveIds = rows.slice(0, at).map((r) => r.task_id).filter((x): x is string => !!x);
  expect(rows.slice(0, at).every((r) => r.task_id)).toBe(true); // no account-level suggestion outranks it
  const { data: above } = aboveIds.length ? await db.from("task").select("id,boost").in("id", aboveIds) : { data: [] as { id: string; boost: number }[] };
  expect((above ?? []).filter((t) => !(t.boost > 0))).toEqual([]);
  const ordinary = rows.slice(at + 1).filter((r) => r.task_id);
  if (ordinary.length) expect(rows[at].score).toBeGreaterThanOrEqual(ordinary[0].score);
});

test("portfolio move: two of an account's properties move to a new manager in one step", async ({ page }) => {
  const from = await fxAccount({ owner: "colby", name: `${uniqueWord()} Residential` });
  const to = await fxAccount({ owner: "colby", name: `${uniqueWord()} Management` });
  const a = await fxProperty({ accountId: from.id, name: `${uniqueWord(2)} Flats A` });
  const b = await fxProperty({ accountId: from.id, name: `${uniqueWord(2)} Flats B` });
  const c = await fxProperty({ accountId: from.id, name: `${uniqueWord(2)} Flats C` });

  await page.goto(`/app/accounts/${from.id}`);
  await expect(page.getByRole("heading", { name: "Properties · 3" })).toBeVisible();
  await tap(page, page.getByRole("button", { name: "Move" }));
  const s = sheet(page);
  await tap(page, s.getByRole("checkbox", { name: new RegExp(a.name) }));
  await tap(page, s.getByRole("checkbox", { name: new RegExp(b.name) }));
  await tap(page, s.getByRole("button", { name: "Next · 2 selected" }));
  await expect(s.getByRole("radio", { name: "New manager" })).toHaveAttribute("aria-checked", "true");
  await pickCompany(s, to.name.split(" ")[0]!, to.name);
  await tap(page, s.getByRole("button", { name: "Next" }));
  await expect(s.getByRole("list", { name: "Properties moving" })).toContainText(a.name);
  await tap(page, s.getByRole("button", { name: "Confirm · move 2" }));
  await expect(toasts(page)).toContainText("Moved 2 properties");

  await expect(page.getByRole("heading", { name: "Properties · 1" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Past properties · 2" })).toBeVisible();
  const past = page.locator("ul").filter({ has: page.getByRole("link", { name: new RegExp(a.name) }) }).last();
  await expect(past).toContainText(`now ${to.name}`);

  const { data } = await db.from("property").select("id,account_id").in("id", [a.id, b.id, c.id]);
  const by = new Map(data!.map((r) => [r.id, r.account_id]));
  expect([by.get(a.id), by.get(b.id), by.get(c.id)]).toEqual([to.id, to.id, from.id]);
  const { count } = await db.from("task").select("id", { count: "exact", head: true }).eq("account_id", to.id).like("title", "Intro%");
  expect(count).toBe(1); // one intro task for the whole move
});

test("a contact changed companies: old touches stay with them and a reconnect task is queued", async ({ page }) => {
  const from = await fxAccount({ owner: "colby", name: `${uniqueWord()} Properties` });
  const to = await fxAccount({ owner: "colby", name: `${uniqueWord()} Partners` });
  const person = await fxContact({ accountId: from.id, persona: "evaluator", title: "Maintenance Director" });
  await fxTouch({ accountId: from.id, contactId: person.id, daysAgo: 20, notes: "First walk" });
  await fxTouch({ accountId: from.id, contactId: person.id, daysAgo: 6, notes: "Sent pricing" });

  await page.goto(`/app/contacts/${person.id}`);
  await tap(page, page.getByRole("button", { name: "Changed companies" }));
  const s = sheet(page);
  await s.getByPlaceholder("Where they work now").fill(to.name.split(" ")[0]!);
  await s.getByRole("button", { name: new RegExp(`^${to.name}`) }).first().click();
  await s.getByLabel("New title").fill("Regional Director");
  await tap(page, s.getByRole("button", { name: "Next" }));
  await expect(s).toContainText(`moves from ${from.name} to ${to.name} as Regional Director`);
  await expect(s).toContainText("All 2 touches stay with");
  await tap(page, s.getByRole("button", { name: "Confirm" }));
  await expect(toasts(page)).toContainText(`is now at ${to.name}`);

  await expect(page.getByRole("main").getByRole("link", { name: to.name }).first()).toBeVisible();
  const timeline = page.locator("ol").filter({ hasText: "Site visit" });
  await expect(timeline.getByText("First walk")).toBeVisible();
  await expect(timeline.getByText("Sent pricing")).toBeVisible();

  const { data: c } = await db.from("contact").select("account_id,title").eq("id", person.id).single();
  expect(c).toMatchObject({ account_id: to.id, title: "Regional Director" });
  const { data: jobs } = await db.from("contact_employment").select("account_id,ended_on").eq("contact_id", person.id);
  expect(jobs!.find((j) => j.account_id === from.id)?.ended_on).not.toBeNull();
  expect(jobs!.find((j) => j.account_id === to.id)?.ended_on).toBeNull();
  const { data: task } = await db.from("task").select("title,boost,status").eq("contact_id", person.id).eq("status", "open").like("title", "Reconnect%").single();
  expect(task?.title).toBe(`Reconnect with ${person.full_name} at ${to.name}`);
  const { count } = await db.from("touch").select("id", { count: "exact", head: true }).eq("contact_id", person.id);
  expect(count).toBe(2);
});

test("flag an active leak: the droplet badge shows on the property row and Today; clearing it keeps the history", async ({ page }) => {
  const acct = await fxAccount({ owner: "colby" });
  const prop = await fxProperty({ accountId: acct.id, name: `${uniqueWord(2)} Lofts` });
  const t = await fxTask({ accountId: acct.id, title: `Check roof at ${prop.name}`, kind: "custom", due: 0 });
  await db.from("task").update({ property_id: prop.id }).eq("id", t.id);

  await page.goto(`/app/properties/${prop.id}`);
  const cond = page.getByRole("group", { name: "Condition" });
  const leak = cond.getByRole("button", { name: "Active leak" });
  await expect(leak).toHaveAttribute("aria-pressed", "false");
  await tap(page, leak);
  await expect(toasts(page)).toContainText("Active leak flagged");
  await expect(leak).toHaveAttribute("aria-pressed", "true");
  await eventually(async () => (await db.from("property_flag").select("id").eq("property_id", prop.id).is("cleared_at", null)).data ?? [], (r) => r.length === 1);

  const row = page.locator('main ul a[href^="/app/properties/"]').filter({ hasText: prop.name });
  await page.goto(`/app/properties?q=${encodeURIComponent(prop.name)}`);
  await expect(row.getByRole("group", { name: /Badges: .*Leak/ })).toBeVisible();
  await page.goto("/app/today");
  const todayRow = page.locator("main li").filter({ hasText: t.title });
  await expect(todayRow.getByRole("group", { name: /Badges: .*Leak/ })).toBeVisible();
  await page.goto(`/app/search?q=${encodeURIComponent(prop.name)}`);
  await expect(page.getByRole("group", { name: /Badges: .*Leak/ }).first()).toBeVisible();

  await page.goto(`/app/properties/${prop.id}`);
  await tap(page, page.getByRole("group", { name: "Condition" }).getByRole("button", { name: "Active leak" }));
  await expect(toasts(page)).toContainText("Active leak cleared");
  await eventually(async () => (await db.from("property_flag").select("cleared_at").eq("property_id", prop.id)).data ?? [], (r) => r.length === 1 && !!r[0]!.cleared_at);
  await page.goto(`/app/properties?q=${encodeURIComponent(prop.name)}`);
  await expect(row).toBeVisible();
  await expect(row.getByText("Leak", { exact: true })).toHaveCount(0);
  const { data: hist } = await db.from("property_flag").select("flag,set_at,cleared_at").eq("property_id", prop.id);
  expect(hist).toHaveLength(1); // history row kept, just cleared
  expect(hist![0]).toMatchObject({ flag: "active_leak" });
});

test("Go stop: big condition toggles flag the building from the field", async ({ page }) => {
  await page.goto("/app/go?city=Austin");
  const stop = page.getByRole("article");
  const group = stop.getByRole("group", { name: "Flag a condition" });
  // Skip ahead to the first stop that has a building.
  for (let i = 0; i < 15 && (await group.count()) === 0; i++) await tap(page, stop.getByRole("button", { name: "Skip to next stop" }));
  await expect(group).toBeVisible();
  const ponding = group.getByRole("button", { name: "Ponding" });
  const before = await ponding.getAttribute("aria-pressed");
  await tap(page, ponding);
  await expect(ponding).toHaveAttribute("aria-pressed", before === "true" ? "false" : "true");
  await expect(toasts(page)).toContainText(before === "true" ? "Ponding cleared" : "Ponding flagged");
  // Put it back so the seeded stop stays clean for re-runs.
  await tap(page, ponding);
  await expect(ponding).toHaveAttribute("aria-pressed", before ?? "false");
});

test("badges: service-line badge on pipeline cards, roof badges on property rows", async ({ page }) => {
  await page.goto("/app/pipeline?scope=mine");
  await expect(page.getByRole("link", { name: /Lincoln — Preston Hollow Bldg 4 TPO re-roof/ }).first()).toContainText("Re-roof");
  await page.goto("/app/properties?q=Monroe");
  await expect(page.getByRole("group", { name: /^Badges: / }).first()).toBeVisible();
});

test("RLS: a FOX rep cannot transfer a TSG property (API and screen)", async ({ page }) => {
  const { data: tsgProp } = await db.from("property").select("id,account_id").eq("tenant_id", await tenantId("tsg")).limit(1).single();
  const colby = await asUser("colby");
  const greystar = await accountIdByName("fox", "Greystar");
  const { error } = await colby.rpc("transfer_property", { p_property: tsgProp!.id, p_role: "manager", p_new_account: greystar });
  expect(error?.message).toMatch(/not found/i);
  const { data: after } = await db.from("property").select("account_id").eq("id", tsgProp!.id).single();
  expect(after?.account_id).toBe(tsgProp!.account_id);
  const { count } = await db.from("property_party").select("id", { count: "exact", head: true }).eq("property_id", tsgProp!.id).eq("source", "transfer");
  expect(count).toBe(0);

  // Writing a property_party row for TSG directly is refused by RLS too.
  const { error: direct } = await colby
    .from("property_party")
    .insert({ tenant_id: await tenantId("tsg"), property_id: tsgProp!.id, account_id: tsgProp!.account_id, role: "owner", source: "rep" });
  expect(direct).not.toBeNull();

  const res = await page.goto(`/app/properties/${tsgProp!.id}`);
  expect(res?.status()).toBe(404);
});
