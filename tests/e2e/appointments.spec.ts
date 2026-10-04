import { chicagoToday, db, dayOffset, eventually, fxAccount, fxProperty, tenantId, userId, uniqueWord } from "./support/db";
import { as, expect, sheet, tap, test, tile, toasts } from "./support/ui";
import { nextWeekday, zonedToUtc } from "../../src/lib/domain/appointments";

// Kayla: appointments for today sit at the top of Today/Go, so keep them off Colby's screens other specs drive.
as("kayla");

async function seriesAccount(n = 3) {
  const acct = await fxAccount({ owner: "kayla", name: `${uniqueWord()} Apartments` });
  const props = [];
  for (let i = 0; i < n; i++) props.push(await fxProperty({ accountId: acct.id, name: `${acct.name.split(" ")[0]} Bldg ${String.fromCharCode(65 + i)}` }));
  return { acct, props };
}

const apptFor = (accountId: string) =>
  eventually(
    async () => (await db.from("appointment").select("id,title,kind,starts_at,status,reschedule_count,booked_touch_id,source,assigned_user_id").eq("account_id", accountId)).data ?? [],
    (r) => r.length > 0,
  );

test.describe("Appointments", () => {
  test("schedule an inspection for a series of 3 buildings from the account → in Coming up, .ics in Chicago time", async ({ page }) => {
    const { acct, props } = await seriesAccount(3);
    const tue = nextWeekday(chicagoToday(), 2);
    await page.goto(`/app/accounts/${acct.id}`);
    await tap(page, page.getByRole("button", { name: "Schedule a visit" }));
    const s = sheet(page);
    await expect(s.getByRole("radio", { name: "Inspection", checked: true })).toBeVisible();
    await s.getByLabel("Date").fill(tue);
    await s.getByLabel("Time").fill("09:00");
    await tap(page, s.getByRole("button", { name: "Pick all 3" }));
    await expect(s.getByText("Buildings · 3 picked")).toBeVisible();
    await tap(page, s.getByRole("button", { name: "Schedule 3 buildings" }));
    await expect(toasts(page)).toContainText(/Appointment set · \+10/);

    const [a] = await apptFor(acct.id);
    expect(a).toMatchObject({ kind: "inspection", status: "scheduled", title: `Inspection · ${acct.name} (3 buildings)`, assigned_user_id: await userId("kayla") });
    expect(new Date(a!.starts_at).toISOString()).toBe(zonedToUtc(tue, "09:00", "America/Chicago").toISOString());
    const { data: stops } = await db.from("appointment_property").select("property_id,sort").eq("appointment_id", a!.id).order("sort");
    expect(stops!.map((x) => x.property_id)).toEqual(props.map((p) => p.id));
    // The account page lists it.
    await expect(page.getByRole("list", { name: "Booked here" })).toContainText(a!.title);

    await page.goto("/app/today");
    const section = page.getByTestId("today-appointments");
    await tap(page, section.getByRole("button", { name: /Coming up · \d+/ }));
    await expect(section.getByRole("list", { name: "Coming up" })).toContainText(a!.title);

    // .ics: DTSTART in local time with the company's TZID.
    const res = await page.request.get(`/app/appointments/${a!.id}/ics`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const ics = await res.text();
    expect(ics).toContain(`DTSTART;TZID=America/Chicago:${tue.replace(/-/g, "")}T090000`);
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/Chicago");

    // Appointment page: Google Calendar link + .ics + stops in order.
    await page.goto(`/app/appointments/${a!.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(a!.title);
    await expect(page.getByRole("list", { name: "Stops in order" }).locator("li")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Google Calendar" })).toHaveAttribute("href", /calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  });

  test("one for today → top of Today and Go; Log outcome (each building) puts a touch on every building's timeline", async ({ page }) => {
    const { acct, props } = await seriesAccount(2);
    await page.goto(`/app/accounts/${acct.id}`);
    await tap(page, page.getByRole("button", { name: "Schedule a visit" }));
    const s = sheet(page);
    await s.getByLabel("Date").fill(chicagoToday());
    await s.getByLabel("Time").fill("23:30");
    await tap(page, s.getByRole("button", { name: "Pick all 2" }));
    await tap(page, s.getByRole("button", { name: "Schedule 2 buildings" }));
    await expect(toasts(page)).toContainText("Appointment set");
    const [a] = await apptFor(acct.id);

    await page.goto("/app/today");
    const top = page.getByTestId("today-appointments");
    // Very top: above the brief, the progress ring and the queue.
    const y = async (l: ReturnType<typeof page.locator>) => (await l.boundingBox())!.y;
    expect(await y(top)).toBeLessThan(await y(page.getByRole("region", { name: "Today's progress" })));
    const row = top.getByTestId("appointment").filter({ hasText: a!.title });
    await expect(row).toContainText("11:30 PM");

    await page.goto("/app/go");
    await expect(page.getByRole("heading", { level: 1, name: "My day" })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(0); // no In person / Calls split
    const goRow = page.getByTestId("today-appointments").getByTestId("appointment").filter({ hasText: a!.title });
    await expect(goRow).toBeVisible();
    await tap(page, goRow.getByRole("button", { name: "2 buildings" }));
    await expect(goRow.getByRole("list", { name: "Buildings in order" }).locator("li")).toHaveCount(2);

    await tap(page, goRow.getByRole("button", { name: "Log outcome" }));
    const log = sheet(page);
    await expect(log.getByTestId("log-appointment")).toBeVisible();
    await expect(log.getByRole("button", { name: /^Inspection — change$/ })).toBeVisible(); // channel from the kind
    await log.getByLabel(/Log each building \(2\)/).check();
    await tap(page, tile(log, "Met in person"));
    await expect(toasts(page)).toContainText("2 buildings logged");

    const touches = await eventually(
      async () => (await db.from("touch").select("property_id,channel,outcome").eq("appointment_id", a!.id)).data ?? [],
      (t) => t.length === 2,
    );
    expect(new Set(touches.map((t) => t.property_id))).toEqual(new Set(props.map((p) => p.id)));
    expect(touches.every((t) => t.channel === "inspection" && t.outcome === "met_in_person")).toBe(true);
    expect((await db.from("appointment").select("status").eq("id", a!.id).single()).data?.status).toBe("done");
    for (const p of props) {
      await page.goto(`/app/properties/${p.id}`);
      await expect(page.locator("main")).toContainText(/Inspection/);
    }
  });

  test("Booked inspection in the Log sheet asks When? and creates the appointment in the same action", async ({ page }) => {
    const { acct, props } = await seriesAccount(1);
    const day = dayOffset(1);
    await page.goto(`/app/properties/${props[0]!.id}`);
    await tap(page, page.getByRole("button", { name: "Log at this building" }));
    const log = sheet(page);
    await tap(page, tile(log, "Call"));
    await tap(page, tile(log, "Booked inspection"));
    const when = log.getByRole("region", { name: "When is the inspection" });
    await expect(when).toBeVisible();
    await when.getByLabel("Date").fill(day);
    await when.getByLabel("Time").fill("10:00");
    await tap(page, when.getByRole("button", { name: "Log + schedule" }));
    await expect(toasts(page)).toContainText("Inspection set");

    const [a] = await apptFor(acct.id);
    expect(a).toMatchObject({ kind: "inspection", source: "log", status: "scheduled" });
    expect(a!.booked_touch_id).not.toBeNull();
    expect(new Date(a!.starts_at).toISOString()).toBe(zonedToUtc(day, "10:00", "America/Chicago").toISOString());
    const { data: stops } = await db.from("appointment_property").select("property_id").eq("appointment_id", a!.id);
    expect(stops).toEqual([{ property_id: props[0]!.id }]);
    // Points: once (the touch), not again for the appointment.
    const { data: pts } = await db.from("point_event").select("points,voided,appointment_id").eq("account_id", acct.id).eq("event", "inspection_booked");
    expect(pts!.filter((p) => !p.voided)).toHaveLength(1);
    // The building page shows it.
    await page.reload();
    await expect(page.getByRole("list", { name: "Booked here" })).toContainText("Inspection");
  });

  test("reschedule keeps history; cancel takes it off the schedule", async ({ page }) => {
    const { acct } = await seriesAccount(1);
    const day = dayOffset(2);
    const { data: a } = await db
      .from("appointment")
      .insert({
        tenant_id: await tenantId("fox"),
        kind: "roof_walk",
        title: `Roof walk · ${acct.name}`,
        starts_at: zonedToUtc(day, "09:00", "America/Chicago").toISOString(),
        ends_at: zonedToUtc(day, "10:00", "America/Chicago").toISOString(),
        account_id: acct.id,
        assigned_user_id: await userId("kayla"),
        created_by: await userId("kayla"),
      })
      .select("id")
      .single();
    await page.goto(`/app/appointments/${a!.id}`);
    await tap(page, page.getByRole("button", { name: "Reschedule / edit" }));
    const s = sheet(page);
    await expect(s.getByLabel("Time")).toHaveValue("09:00");
    await s.getByLabel("Time").fill("11:15");
    await tap(page, s.getByRole("button", { name: "Save changes" }));
    await expect(toasts(page)).toContainText("Appointment updated");
    const moved = await eventually(
      async () => (await db.from("appointment").select("starts_at,reschedule_count").eq("id", a!.id).single()).data!,
      (r) => r.reschedule_count === 1,
    );
    expect(new Date(moved.starts_at).toISOString()).toBe(zonedToUtc(day, "11:15", "America/Chicago").toISOString());
    await expect(page.getByText(/Moved: .*9:00 AM → .*11:15 AM/)).toBeVisible();

    await tap(page, page.getByRole("button", { name: "Cancel…" }));
    await page.getByLabel("Why").fill("PM moved to Friday");
    await tap(page, page.getByRole("button", { name: "Cancel it" }));
    await expect(toasts(page)).toContainText("Appointment canceled");
    await eventually(async () => (await db.from("appointment").select("status").eq("id", a!.id).single()).data!.status, (st) => st === "canceled");
    await expect(page.getByText("Canceled — PM moved to Friday")).toBeVisible();
  });

  test("a FOX rep can't open a TSG appointment (404)", async ({ page }) => {
    const { data: a, error } = await db
      .from("appointment")
      .insert({ tenant_id: await tenantId("tsg"), kind: "meeting", title: "TSG only", starts_at: new Date(Date.now() + 86_400_000).toISOString() })
      .select("id")
      .single();
    expect(error).toBeNull();
    const res = await page.goto(`/app/appointments/${a!.id}`);
    expect(res?.status()).toBe(404);
    expect((await page.request.get(`/app/appointments/${a!.id}/ics`)).status()).toBe(404);
  });
});
