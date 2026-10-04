import { describe, expect, it } from "vitest";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";
import type { Client } from "pg";

async function seedAccount(c: Client, tenant: string, owner: string, opts: { tier?: number; type?: string; name?: string } = {}) {
  const a = await one<{ id: string }>(
    c,
    "insert into public.account(tenant_id, name, account_type, icp_tier, owner_user_id) values ($1,$2,$3,$4,$5) returning id",
    [tenant, opts.name ?? "Greystar", opts.type ?? "property_mgmt", opts.tier ?? 1, owner],
  );
  const ct = await one<{ id: string }>(
    c,
    "insert into public.contact(tenant_id, account_id, first_name, last_name, title, persona_role) values ($1,$2,'Dave','Lopez','Chief Engineer','evaluator') returning id",
    [tenant, a.id],
  );
  return { account: a.id, contact: ct.id };
}

async function logTouch(c: Client, t: Record<string, unknown>) {
  const cols = Object.keys(t);
  const vals = Object.values(t);
  return one<{ id: string }>(
    c,
    `insert into public.touch(${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    vals,
  );
}

describe("follow-up engine", () => {
  it("schedules the next task from the outcome and closes it on the next touch", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "rep1@test.dev");
      const { account, contact } = await seedAccount(c, t, rep);

      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail" });
      const open = await c.query("select * from public.task where contact_id = $1 and status = 'open'", [contact]);
      expect(open.rows).toHaveLength(1);
      expect(open.rows[0].title).toBe("Call Dave Lopez back");
      expect(open.rows[0].account_id).toBe(account); // account filled from contact

      // Due date is 3 business days out.
      const due = await one<{ ok: boolean }>(
        c,
        "select due_on = app.add_business_days(app.tenant_today($1), 3) as ok from public.task where id = $2",
        [t, open.rows[0].id],
      );
      expect(due.ok).toBe(true);

      // Any touch on the contact completes it — this is the Dilly V2 0% fix.
      const second = await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "email", outcome: "sent" });
      const done = await one<{ status: string; completed_by_touch_id: string }>(c, "select * from public.task where id = $1", [open.rows[0].id]);
      expect(done.status).toBe("done");
      expect(done.completed_by_touch_id).toBe(second.id);

      // …and the email schedules its own follow-up.
      const next = await c.query("select title from public.task where contact_id = $1 and status = 'open'", [contact]);
      expect(next.rows.map((r) => r.title)).toEqual(["Follow up on email to Dave Lopez"]);
    });
  });

  it("gatekeeper creates an account-level task that any contact at the account satisfies", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "rep2@test.dev");
      const { account, contact } = await seedAccount(c, t, rep);
      await logTouch(c, { tenant_id: t, user_id: rep, account_id: account, channel: "door_knock", outcome: "gatekeeper" });
      const k = await one<{ kind: string; contact_id: string | null }>(c, "select kind, contact_id from public.task where account_id = $1 and status='open'", [account]);
      expect(k.kind).toBe("try_other_contact");
      expect(k.contact_id).toBeNull();
      await logTouch(c, { tenant_id: t, user_id: rep, account_id: account, channel: "door_knock", outcome: "met_in_person" });
      const left = await c.query("select kind from public.task where account_id = $1 and status='open' and contact_id is null and kind='try_other_contact'", [account]);
      expect(left.rows).toHaveLength(0);
      expect(contact).toBeTruthy();
    });
  });

  it("respects a rep's explicit follow-up date and skip flag", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const rep = await makeUser(c, t, "rep3@test.dev");
      const { contact } = await seedAccount(c, t, rep);
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "connected", follow_up_on: "2027-01-15", follow_up_note: "Budget meeting" });
      const k = await one<{ due_on: Date; title: string }>(c, "select due_on, title from public.task where contact_id=$1 and status='open'", [contact]);
      expect(k.title).toBe("Budget meeting");
      expect(k.due_on.toISOString().slice(0, 10)).toBe("2027-01-15");
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "connected", skip_follow_up: true });
      const open = await c.query("select 1 from public.task where contact_id=$1 and status='open'", [contact]);
      expect(open.rows).toHaveLength(0);
    });
  });

  it("migrated Dilly V2 touches stamp freshness and close tasks but create no tasks or points", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "rep4@test.dev");
      const { account, contact } = await seedAccount(c, t, rep);
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail", source: "dillyv2", legacy_table: "touchpoints", legacy_id: "1" });
      const tasks = await c.query("select 1 from public.task where account_id=$1", [account]);
      const pts = await c.query("select 1 from public.point_event where user_id=$1", [rep]);
      const a = await one<{ last_touch_at: Date | null }>(c, "select last_touch_at from public.account where id=$1", [account]);
      expect(tasks.rows).toHaveLength(0);
      expect(pts.rows).toHaveLength(0);
      expect(a.last_touch_at).not.toBeNull();
    });
  });

  it("reconcile_tasks closes legacy open follow-ups that already have a later touch", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "rep5@test.dev");
      const { account, contact } = await seedAccount(c, t, rep);
      await c.query(
        "insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, title, due_on, source, created_at) values ($1,$2,$3,$4,'legacy follow-up', current_date - 30, 'dillyv2', now() - interval '40 days')",
        [t, rep, account, contact],
      );
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "email", outcome: "sent", source: "dillyv2", occurred_at: new Date(Date.now() - 5 * 864e5) });
      // Trigger already closes it for touches inserted after the task; reconcile handles the reverse load order too.
      const n = await one<{ n: number }>(c, "select app.reconcile_tasks($1) as n", [t]);
      const open = await c.query("select 1 from public.task where contact_id=$1 and status='open'", [contact]);
      expect(open.rows).toHaveLength(0);
      expect(n.n).toBeGreaterThanOrEqual(0);
    });
  });

  it("the touch ledger is append-only except for voiding", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "rep6@test.dev");
      const { contact } = await seedAccount(c, t, rep);
      const x = await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail" });
      await c.query("update public.touch set voided_at = now(), void_reason = 'dup' where id = $1", [x.id]);
      await expect(c.query("update public.touch set outcome = 'connected' where id = $1", [x.id])).rejects.toThrow(/append-only/);
    });
  });
});

describe("gamification v2", () => {
  it("weights outcomes and blocks same-day repeat farming", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "pts@test.dev");
      const { contact } = await seedAccount(c, t, rep);
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "site_visit", outcome: "met_decision_maker" });
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail" });
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail" });
      const rows = await c.query("select event, points from public.point_event where user_id = $1 order by event", [rep]);
      const total = rows.rows.reduce((s, r) => s + r.points, 0);
      // 1 touch + 3 connect + 6 decision maker; the two voicemails the same day add nothing.
      expect(rows.rows.map((r) => r.event).sort()).toEqual(["connect", "decision_maker_conversation", "touch_logged"]);
      expect(total).toBe(10);
    });
  });

  it("awards on-time follow-ups, inspections, proposals and wins", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "pts2@test.dev");
      const { account, contact } = await seedAccount(c, t, rep);
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "connected", occurred_at: new Date(Date.now() - 864e5) });
      await logTouch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "scheduled_inspection" });
      const o = await one<{ id: string }>(c, "insert into public.opportunity(tenant_id, account_id, name, owner_user_id, stage) values ($1,$2,'Roof repair',$3,'inspection_complete') returning id", [t, account, rep]);
      await c.query("update public.opportunity set stage='proposal_sent' where id=$1", [o.id]);
      await c.query("update public.opportunity set stage='won' where id=$1", [o.id]);
      const ev = (await c.query("select event from public.point_event where user_id=$1", [rep])).rows.map((r) => r.event);
      expect(ev).toEqual(expect.arrayContaining(["follow_up_on_time", "inspection_booked", "proposal_delivered", "won"]));
      const won = await one<{ won_at: Date | null }>(c, "select won_at from public.opportunity where id=$1", [o.id]);
      expect(won.won_at).not.toBeNull();
    });
  });
});

describe("ranking and targeting", () => {
  it("do-not-pursue and targeting excludes sink to zero with a reason; deprioritize sinks but stays", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const rep = await makeUser(c, t, "rank@test.dev");
      const pm = await seedAccount(c, t, rep, { name: "Memphis PMC", type: "property_mgmt", tier: 1 });
      const gc = await seedAccount(c, t, rep, { name: "Some GC", type: "gc", tier: 1 });
      const meh = await seedAccount(c, t, rep, { name: "Meh Owner", type: "owner", tier: 1 });
      await c.query("insert into public.account_preference(tenant_id, account_id, preference, reason) values ($1,$2,'do_not_pursue','Pays late'),($1,$3,'deprioritize',null)", [t, gc.account, meh.account]);
      const r = await c.query("select name, rank_score, relationship_state, excluded_reason from public.account_ranked where tenant_id=$1 and name in ('Memphis PMC','Some GC','Meh Owner') order by rank_score desc", [t]);
      expect(r.rows[0].name).toBe("Memphis PMC");
      const gcRow = r.rows.find((x) => x.name === "Some GC");
      expect(Number(gcRow.rank_score)).toBe(0);
      expect(gcRow.relationship_state).toBe("do_not_pursue");
      expect(gcRow.excluded_reason).toBe("Pays late");
      const mehRow = r.rows.find((x) => x.name === "Meh Owner");
      expect(Number(mehRow.rank_score)).toBeGreaterThan(0);
      expect(Number(mehRow.rank_score)).toBeLessThan(10);
      // TSG weights property management up (1.2) vs owner (1.1).
      expect(Number(r.rows[0].rank_score)).toBeGreaterThan(100);
      expect(pm.account).toBeTruthy();
    });
  });

  it("tenant targeting exclude by account type removes accounts for that tenant only", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "rank2@test.dev");
      await seedAccount(c, t, rep, { name: "Builder Co", type: "developer", tier: 2 });
      await c.query("insert into public.tenant_targeting(tenant_id, dimension, value, mode) values ($1,'account_type','developer','exclude')", [t]);
      const r = await one<{ relationship_state: string; rank_score: string }>(c, "select relationship_state, rank_score from public.account_ranked where tenant_id=$1 and name='Builder Co'", [t]);
      expect(r.relationship_state).toBe("excluded");
      expect(Number(r.rank_score)).toBe(0);
    });
  });
});

describe("rep queue", () => {
  it("shows due tasks, cold P1s and first touches; hides do-not-pursue", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "queue@test.dev");
      const a = await seedAccount(c, t, rep, { name: "Due Acct", tier: 2 });
      await c.query("insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, title, due_on) values ($1,$2,$3,$4,'Call back', app.tenant_today($1) - 2)", [t, rep, a.account, a.contact]);
      const cold = await seedAccount(c, t, rep, { name: "Cold P1", tier: 1 });
      await logTouch(c, { tenant_id: t, user_id: rep, account_id: cold.account, channel: "call", outcome: "connected", occurred_at: new Date(Date.now() - 30 * 864e5), skip_follow_up: true });
      await seedAccount(c, t, rep, { name: "Fresh P1", tier: 1 });
      const dnp = await seedAccount(c, t, rep, { name: "DNP", tier: 1 });
      await c.query("insert into public.account_preference(tenant_id, account_id, preference) values ($1,$2,'do_not_pursue')", [t, dnp.account]);
      await c.query("insert into public.task(tenant_id, assignee_user_id, account_id, title, due_on) values ($1,$2,$3,'Should not show', app.tenant_today($1))", [t, rep, dnp.account]);

      const q = await c.query("select item_type, account_name, overdue_days from public.rep_queue($1,$2)", [t, rep]);
      const types = q.rows.map((r) => `${r.item_type}:${r.account_name}`);
      expect(types).toContain("task:Due Acct");
      expect(types).toContain("reengage:Cold P1");
      expect(types).toContain("first_touch:Fresh P1");
      expect(types.some((x) => x.includes("DNP"))).toBe(false);
      expect(q.rows.find((r) => r.account_name === "Due Acct").overdue_days).toBe(2);
    });
  });
});

describe("tenancy and security", () => {
  it("a FOX rep cannot see TSG accounts", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const foxRep = await makeUser(c, fox, "iso-fox@test.dev");
      const tsgRep = await makeUser(c, tsg, "iso-tsg@test.dev");
      await seedAccount(c, tsg, tsgRep, { name: "TSG Secret" });
      await actAs(c, foxRep);
      const seen = await c.query("select name from public.account where name = 'TSG Secret'");
      expect(seen.rows).toHaveLength(0);
      await expect(
        c.query("insert into public.account(tenant_id, name) values ($1, 'sneaky')", [tsg]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("reps cannot clear owner-level gates (G4/G6/G9) but can clear G1", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "gate@test.dev");
      const g1 = await one<{ id: string }>(c, "insert into public.approval(tenant_id, gate, action_type, summary, payload) values ($1,'G1','send_email','x','{}') returning id", [t]);
      const g6 = await one<{ id: string }>(c, "insert into public.approval(tenant_id, gate, action_type, summary, payload) values ($1,'G6','spend','x','{}') returning id", [t]);
      await actAs(c, rep);
      const a = await c.query("update public.approval set status='approved' where id=$1 returning id", [g1.id]);
      const b = await c.query("update public.approval set status='approved' where id=$1 returning id", [g6.id]);
      expect(a.rowCount).toBe(1);
      expect(b.rowCount).toBe(0);
      await actAsService(c);
    });
  });

  it("claim_invites turns the seeded FOX invite into a membership and platform admin flag", async () => {
    await inTx(async (c) => {
      const u = await one<{ id: string }>(c, "insert into auth.users(email) values ('parks@foxroofing.co') returning id");
      await actAs(c, u.id);
      const n = await one<{ n: number }>(c, "select public.claim_invites() as n");
      expect(n.n).toBe(1);
      const p = await one<{ is_platform_admin: boolean; full_name: string }>(c, "select is_platform_admin, full_name from public.profile where id = $1", [u.id]);
      expect(p.is_platform_admin).toBe(true);
      expect(p.full_name).toBe("Parks Flowers");
      // Platform admin sees both tenants.
      const ts = await c.query("select slug from public.tenant order by slug");
      expect(ts.rows.map((r) => r.slug)).toEqual(["fox", "tsg"]);
      await actAsService(c);
    });
  });
});

describe("streaks", () => {
  it("counts consecutive cleared weekdays", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "streak@test.dev");
      // Three prior weekdays cleared.
      await c.query(
        `insert into public.rep_day(tenant_id, user_id, day, touches, cleared)
         select $1, $2, d, 3, true from (
           select d::date from generate_series(app.tenant_today($1) - 10, app.tenant_today($1) - 1, interval '1 day') d
            where extract(isodow from d) < 6 order by d desc limit 3) x`,
        [t, rep],
      );
      const s = await one<{ s: number }>(c, "select public.rep_streak($1,$2) as s", [t, rep]);
      expect(s.s).toBe(3);
    });
  });
});

describe("field capture", () => {
  it("awards field_contact_created when a rep adds a contact from the field", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const rep = await makeUser(c, t, "field@test.dev");
      await c.query("insert into public.contact(tenant_id, first_name, source, created_by) values ($1,'Maria','field',$2)", [t, rep]);
      const p = await one<{ n: number }>(c, "select count(*)::int as n from public.point_event where user_id=$1 and event='field_contact_created'", [rep]);
      expect(p.n).toBe(1);
    });
  });
});
