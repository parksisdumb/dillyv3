// Pins 20261004400000_appointments.sql: RLS across companies, completing by logging the outcome (one touch or one per
// building), booking points without double counting, the "Log outcome" task for appointments left open, and the
// scorecard counting completed appointments once.
import type { Client } from "pg";
import { describe, expect, it } from "vitest";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

async function setup(c: Client) {
  const fox = await tenantId(c, "fox");
  const tsg = await tenantId(c, "tsg");
  const rep = await makeUser(c, fox, `appt-rep-${Math.random().toString(36).slice(2)}@foxroofing.co`);
  const other = await makeUser(c, tsg, `appt-tsg-${Math.random().toString(36).slice(2)}@thesvcgroup.com`);
  const acct = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id) values ($1,'Appt Apartments',$2) returning id", [fox, rep])).id;
  const props: string[] = [];
  for (const n of [1, 2, 3]) {
    props.push(
      (await one<{ id: string }>(c, "insert into public.property(tenant_id, account_id, name, address1, city, state) values ($1,$2,$3,$4,'Austin','TX') returning id", [fox, acct, `Bldg ${n}`, `${n}00 Main St`])).id,
    );
  }
  const contact = (await one<{ id: string }>(c, "insert into public.contact(tenant_id, account_id, first_name, last_name) values ($1,$2,'Dana','Pm') returning id", [fox, acct])).id;
  const tsgProp = (await one<{ id: string }>(c, "insert into public.property(tenant_id, name) values ($1,'TSG bldg') returning id", [tsg])).id;
  return { fox, tsg, rep, other, acct, props, contact, tsgProp };
}

async function book(c: Client, s: Awaited<ReturnType<typeof setup>>, o: { kind?: string; at?: string; props?: string[]; booked?: string | null } = {}) {
  const a = await one<{ id: string }>(
    c,
    `insert into public.appointment(tenant_id, kind, title, starts_at, ends_at, account_id, assigned_user_id, created_by, booked_touch_id)
     values ($1,$2,'Inspection · Appt Apartments',$3::timestamptz,$3::timestamptz + interval '1 hour',$4,$5,$5,$6) returning id`,
    [s.fox, o.kind ?? "inspection", o.at ?? new Date(Date.now() + 86_400_000).toISOString(), s.acct, s.rep, o.booked ?? null],
  );
  const props = o.props ?? s.props;
  for (let i = 0; i < props.length; i++) {
    await c.query("insert into public.appointment_property(tenant_id, appointment_id, property_id, sort) values ($1,$2,$3,$4)", [s.fox, a.id, props[i], i]);
  }
  return a.id;
}

const points = async (c: Client, user: string, event = "inspection_booked") =>
  (await c.query("select points, voided, touch_id, appointment_id from public.point_event where user_id = $1 and event = $2 order by occurred_at", [user, event])).rows as {
    points: number;
    voided: boolean;
    touch_id: string | null;
    appointment_id: string | null;
  }[];

describe("appointments — RLS", () => {
  it("another company's rep can't see, change or link into an appointment", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      const id = await book(c, s);
      // Location defaults from the first building.
      expect((await one<{ location: string }>(c, "select location from public.appointment where id = $1", [id])).location).toBe("100 Main St, Austin, TX");

      await actAsService(c);
      await actAs(c, s.other);
      expect((await c.query("select id from public.appointment where id = $1", [id])).rowCount).toBe(0);
      expect((await c.query("select 1 from public.appointment_property where appointment_id = $1", [id])).rowCount).toBe(0);
      expect((await c.query("update public.appointment set title = 'x' where id = $1", [id])).rowCount).toBe(0);
      await c.query("savepoint s");
      await expect(
        c.query("insert into public.appointment(tenant_id, title, starts_at) values ($1,'Sneaky',now())", [s.fox]),
      ).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s");
      await expect(c.query("select public.log_appointment_outcome($1,'inspection','met_in_person')", [id])).rejects.toThrow(/not found/);
      await c.query("rollback to savepoint s");

      // A FOX appointment can't point at a TSG building.
      await actAsService(c);
      await actAs(c, s.rep);
      await expect(
        c.query("insert into public.appointment_property(tenant_id, appointment_id, property_id) values ($1,$2,$3)", [s.fox, id, s.tsgProp]),
      ).rejects.toThrow(/another company|row-level security/);
    });
  });
});

describe("appointments — completing by logging the outcome", () => {
  it("log each building: a touch on every building's timeline, points and one follow-up from the outcome touch only; idempotent", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      const id = await book(c, s);
      const main = (
        await one<{ t: string }>(c, "select public.log_appointment_outcome($1,'inspection','met_in_person',$2,null,'Walked all 3',true,'idem:abc') as t", [id, s.contact])
      ).t;
      const touches = (await c.query("select id, property_id, channel, outcome, skip_follow_up from public.touch where appointment_id = $1 order by occurred_at desc", [id])).rows;
      expect(touches).toHaveLength(3);
      expect(new Set(touches.map((t) => t.property_id))).toEqual(new Set(s.props));
      expect(touches[0].id).toBe(main);
      expect(touches.every((t) => t.channel === "inspection" && t.outcome === "met_in_person")).toBe(true);

      const a = await one<{ status: string; outcome_touch_id: string }>(c, "select status, outcome_touch_id from public.appointment where id = $1", [id]);
      expect(a).toEqual({ status: "done", outcome_touch_id: main });
      // Points: only the outcome touch's are live.
      const live = (await c.query("select touch_id from public.point_event where touch_id = any($1) and not voided", [touches.map((t) => t.id)])).rows;
      expect(live.every((r) => r.touch_id === main)).toBe(true);
      expect(live.length).toBeGreaterThan(0);
      // One follow-up task from the outcome.
      expect((await c.query("select 1 from public.task where created_from_touch_id = any($1) and status = 'open'", [touches.map((t) => t.id)])).rowCount).toBe(1);

      // Retry (offline replay / double tap): same touch, nothing new.
      const again = (await one<{ t: string }>(c, "select public.log_appointment_outcome($1,'inspection','met_in_person',$2,null,null,true,'idem:abc') as t", [id, s.contact])).t;
      expect(again).toBe(main);
      expect((await c.query("select 1 from public.touch where appointment_id = $1", [id])).rowCount).toBe(3);
    });
  });

  it("default: one touch at the account; a canceled appointment can't be completed", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      const id = await book(c, s, { kind: "meeting" });
      await c.query("select public.log_appointment_outcome($1,'meeting','met_decision_maker')", [id]);
      const t = (await c.query("select account_id, property_id from public.touch where appointment_id = $1", [id])).rows;
      expect(t).toEqual([{ account_id: s.acct, property_id: null }]);

      const id2 = await book(c, s, { kind: "meeting" });
      await c.query("update public.appointment set status = 'canceled' where id = $1", [id2]);
      await expect(c.query("select public.log_appointment_outcome($1,'meeting','met_in_person')", [id2])).rejects.toThrow(/canceled/);
    });
  });
});

describe("appointments — booking points (no double counting)", () => {
  it("scheduling an inspection awards inspection_booked once; a 'Booked inspection' touch the same day on that account is voided", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      await book(c, s);
      await book(c, s, { props: [s.props[0]] }); // second booking, same account, same day → no second award
      await c.query(
        "insert into public.touch(tenant_id, user_id, account_id, contact_id, channel, outcome) values ($1,$2,$3,$4,'call','scheduled_inspection')",
        [s.fox, s.rep, s.acct, s.contact],
      );
      const p = await points(c, s.rep);
      expect(p.filter((x) => !x.voided)).toHaveLength(1);
      expect(p.filter((x) => !x.voided)[0].appointment_id).not.toBeNull();
      expect(p.find((x) => x.touch_id)?.voided).toBe(true);
    });
  });

  it("an appointment created from the logged touch (Log sheet → When?) isn't awarded again; meetings award nothing; cancel voids", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      const t = await one<{ id: string }>(
        c,
        "insert into public.touch(tenant_id, user_id, account_id, contact_id, channel, outcome) values ($1,$2,$3,$4,'call','scheduled_inspection') returning id",
        [s.fox, s.rep, s.acct, s.contact],
      );
      await book(c, s, { booked: t.id });
      await book(c, s, { kind: "meeting" });
      let p = await points(c, s.rep);
      expect(p.filter((x) => !x.voided)).toEqual([expect.objectContaining({ touch_id: t.id, points: 10 })]);

      // A fresh booking on another account → awarded; canceling it voids it.
      const acct2 = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'Other Co') returning id", [s.fox])).id;
      const a2 = (
        await one<{ id: string }>(
          c,
          "insert into public.appointment(tenant_id, kind, title, starts_at, account_id, assigned_user_id, created_by) values ($1,'roof_walk','Walk',now() + interval '2 days',$2,$3,$3) returning id",
          [s.fox, acct2, s.rep],
        )
      ).id;
      p = await points(c, s.rep);
      expect(p.filter((x) => !x.voided)).toHaveLength(2);
      await c.query("update public.appointment set status = 'canceled', cancel_reason = 'PM moved it' where id = $1", [a2]);
      p = await points(c, s.rep);
      expect(p.find((x) => x.appointment_id === a2)?.voided).toBe(true);
      const hist = (await c.query("select field, old_value, new_value from public.appointment_change where appointment_id = $1", [a2])).rows;
      expect(hist).toEqual([{ field: "status", old_value: "scheduled", new_value: "canceled" }]);
    });
  });
});

describe("appointments — the 'Log outcome' task and rescheduling", () => {
  it("the day after, an appointment with no outcome gets one task; logging closes it; reschedule keeps history", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      const id = await book(c, s, { at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
      expect((await one<{ n: number }>(c, "select public.appointment_outcome_tasks($1) as n", [s.fox])).n).toBe(1);
      expect((await one<{ n: number }>(c, "select public.appointment_outcome_tasks($1) as n", [s.fox])).n).toBe(0);
      const task = await one<{ id: string; title: string; assignee_user_id: string; status: string }>(
        c,
        "select id, title, assignee_user_id, status from public.task where appointment_id = $1",
        [id],
      );
      expect(task).toMatchObject({ title: "Log outcome: Inspection · Appt Apartments", assignee_user_id: s.rep, status: "open" });

      // Upcoming appointments never get one.
      const future = await book(c, s);
      await c.query("select public.appointment_outcome_tasks($1)", [s.fox]);
      expect((await c.query("select 1 from public.task where appointment_id = $1", [future])).rowCount).toBe(0);

      await c.query("select public.log_appointment_outcome($1,'inspection','met_in_person')", [id]);
      expect((await one<{ status: string }>(c, "select status from public.task where id = $1", [task.id])).status).toBe("done");

      // Reschedule: count + history row.
      await c.query("update public.appointment set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where id = $1", [future]);
      const r = await one<{ reschedule_count: number }>(c, "select reschedule_count from public.appointment where id = $1", [future]);
      expect(r.reschedule_count).toBe(1);
      expect((await c.query("select field from public.appointment_change where appointment_id = $1", [future])).rows).toEqual([{ field: "starts_at" }]);
    });
  });
});

describe("appointments — scorecard", () => {
  it("a completed inspection counts once as a qualified meeting, however many buildings were logged", async () => {
    await inTx(async (c) => {
      const s = await setup(c);
      await actAs(c, s.rep);
      const before = await one<{ n: number }>(c, "select coalesce(sum(meetings),0)::int as n from public.team_scorecard($1) where user_id = $2 and bucket = 'month'", [s.fox, s.rep]);
      const id = await book(c, s, { at: new Date(Date.now() - 3600_000).toISOString() });
      await c.query("select public.log_appointment_outcome($1,'inspection','met_in_person',null,null,null,true)", [id]);
      const after = await one<{ n: number }>(c, "select coalesce(sum(meetings),0)::int as n from public.team_scorecard($1) where user_id = $2 and bucket = 'month'", [s.fox, s.rep]);
      expect(after.n - before.n).toBe(1);

      // A no-show doesn't count.
      const ns = await book(c, s, { at: new Date(Date.now() - 7200_000).toISOString() });
      await c.query("update public.appointment set status = 'no_show' where id = $1", [ns]);
      const final = await one<{ n: number }>(c, "select coalesce(sum(meetings),0)::int as n from public.team_scorecard($1) where user_id = $2 and bucket = 'month'", [s.fox, s.rep]);
      expect(final.n).toBe(after.n);
    });
  });
});
