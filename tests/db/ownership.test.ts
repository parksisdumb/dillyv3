import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

type Ids = Record<string, string>;

async function ins(c: Client, table: string, row: Record<string, unknown>): Promise<string> {
  const cols = Object.keys(row);
  const r = await one<{ id: string }>(
    c,
    `insert into public.${table}(${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`,
    Object.values(row),
  );
  return r.id;
}

/** Riverside Apartments managed by Greystar, with people, touches, roof facts and two opportunities. */
async function seedRiverside(c: Client, t: string, rep: string): Promise<Ids> {
  const greystar = await ins(c, "account", { tenant_id: t, name: "Greystar", account_type: "property_mgmt", icp_tier: 1, owner_user_id: rep });
  const rpm = await ins(c, "account", { tenant_id: t, name: "RPM Living", account_type: "property_mgmt", icp_tier: 3, owner_user_id: rep });
  const riverside = await ins(c, "property", {
    tenant_id: t, account_id: greystar, name: "Riverside Apartments", address1: "1801 S Pleasant Valley Rd", city: "Austin",
    roof_system: "TPO", roof_install_year: 2009, roof_area_sf: 186000,
  });
  const contact = (first: string, last: string, title: string, role = "user") =>
    ins(c, "contact", { tenant_id: t, account_id: greystar, first_name: first, last_name: last, title, persona_role: role });
  const luis = await contact("Luis", "Ortega", "Maintenance Supervisor");
  const maria = await contact("Maria", "Chen", "Community Manager", "gatekeeper");
  const dave = await contact("Dave", "Morales", "Regional Facilities Director", "economic_buyer");
  const other = await contact("Sam", "Green", "Leasing Agent");
  for (const [cid, role] of [[luis, "On site"], [maria, "Office"], [dave, "Capex"], [other, null]] as const) {
    await c.query("insert into public.property_contact(tenant_id, property_id, contact_id, role) values ($1,$2,$3,$4)", [t, riverside, cid, role]);
  }
  const openOpp = await ins(c, "opportunity", {
    tenant_id: t, account_id: greystar, property_id: riverside, name: "Riverside re-roof", service_line: "re_roof",
    stage: "proposal_sent", value_estimate: 160000, owner_user_id: rep, next_step: "Board vote", next_step_due: "2030-01-15",
  });
  const wonOpp = await ins(c, "opportunity", {
    tenant_id: t, account_id: greystar, property_id: riverside, name: "Riverside leak 2025", service_line: "repair",
    stage: "won", value_estimate: 9000, owner_user_id: rep,
  });
  for (let i = 0; i < 3; i++) {
    await ins(c, "touch", {
      tenant_id: t, user_id: rep, contact_id: i === 0 ? dave : luis, property_id: riverside, channel: "site_visit", outcome: "met_in_person",
      media: JSON.stringify([{ path: `photos/riverside-${i}.jpg` }]), occurred_at: new Date(Date.now() - (i + 2) * 864e5),
    });
  }
  return { greystar, rpm, riverside, luis, maria, dave, other, openOpp, wonOpp };
}

async function rpc<T = Record<string, unknown>>(c: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args);
  return one<T>(c, `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, Object.values(args));
}

describe("property ownership & management history", () => {
  it("backfill: existing properties and contacts have current history rows", async () => {
    await inTx(async (c) => {
      // Rows created before the migration were backfilled; rows created after get theirs from the insert triggers.
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bf@test.dev");
      const x = await seedRiverside(c, t, rep);
      const pp = await c.query("select role, account_id, started_on, ended_on, source from public.property_party where property_id = $1", [x.riverside]);
      expect(pp.rows).toEqual([{ role: "manager", account_id: x.greystar, started_on: null, ended_on: null, source: "insert" }]);
      const ce = await one<{ n: string }>(c, "select count(*) as n from public.contact_employment where account_id = $1 and ended_on is null", [x.greystar]);
      expect(Number(ce.n)).toBe(4);
      const orphans = await one<{ n: string }>(
        c,
        `select count(*) as n from public.property p where p.account_id is not null
           and not exists (select 1 from public.property_party x where x.property_id = p.id and x.ended_on is null and x.account_id = p.account_id)`,
      );
      expect(Number(orphans.n)).toBe(0);
    });
  });

  it("transfer keeps touches, photos, roof facts and opportunities on the building and records history", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "xfer1@test.dev");
      const x = await seedRiverside(c, t, rep);
      await actAs(c, rep);
      const before = await one<{ n: string }>(c, "select count(*) as n from public.touch where property_id = $1", [x.riverside]);

      const party = await rpc<{ r: string }>(c, "transfer_property", {
        p_property: x.riverside, p_role: "manager", p_new_account: x.rpm,
        p_contacts_with_building: [x.luis, x.maria], p_contacts_with_old_company: [x.dave], p_note: "RPM took over Oct 1",
      });
      expect(party.r).toMatch(/^[0-9a-f-]{36}$/);

      const p = await one<Record<string, unknown>>(c, "select * from public.property where id = $1", [x.riverside]);
      expect(p.account_id).toBe(x.rpm);
      expect(p.roof_system).toBe("TPO");
      expect(p.roof_install_year).toBe(2009);
      const after = await one<{ n: string; media: string }>(
        c, "select count(*) as n, sum(jsonb_array_length(media)) as media from public.touch where property_id = $1", [x.riverside]);
      expect(after.n).toBe(before.n);
      expect(Number(after.media)).toBe(3);

      const hist = await c.query(
        "select account_id, ended_on is null as current, source, note from public.property_party where property_id = $1 and role = 'manager' order by created_at, ended_on nulls last",
        [x.riverside],
      );
      expect(hist.rows).toEqual([
        { account_id: x.greystar, current: false, source: "insert", note: null },
        { account_id: x.rpm, current: true, source: "transfer", note: "RPM took over Oct 1" },
      ]);

      // Open job follows the buyer (the manager); the won job stays with the company that did the business.
      const opps = await c.query("select id, account_id from public.opportunity where property_id = $1", [x.riverside]);
      const acct = Object.fromEntries(opps.rows.map((r) => [r.id, r.account_id]));
      expect(acct[x.openOpp]).toBe(x.rpm);
      expect(acct[x.wonOpp]).toBe(x.greystar);
      const nextStep = await one<{ account_id: string }>(c, "select account_id from public.task where opportunity_id = $1 and status = 'open'", [x.openOpp]);
      expect(nextStep.account_id).toBe(x.rpm);

      const sig = await one<{ kind: string; headline: string }>(c, "select kind, headline from public.signal where property_id = $1", [x.riverside]);
      expect(sig).toEqual({ kind: "management_change", headline: "Riverside Apartments moved from Greystar to RPM Living" });

      const cur = await one<Record<string, unknown>>(
        c, "select current_manager_name, current_owner_name, management_changed_on is not null as changed, open_service_lines from public.property_current where id = $1", [x.riverside]);
      expect(cur).toEqual({ current_manager_name: "RPM Living", current_owner_name: null, changed: true, open_service_lines: ["re_roof"] });
    });
  });

  it("people with the building move to the new company; the old company's people stay and are unlinked here", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "xfer2@test.dev");
      const x = await seedRiverside(c, t, rep);
      await actAs(c, rep);
      await rpc(c, "transfer_property", {
        p_property: x.riverside, p_role: "manager", p_new_account: x.rpm,
        p_contacts_with_building: [x.luis, x.maria], p_contacts_with_old_company: [x.dave],
      });
      const people = await c.query("select id, account_id from public.contact where id = any($1)", [[x.luis, x.maria, x.dave, x.other]]);
      const at = Object.fromEntries(people.rows.map((r) => [r.id, r.account_id]));
      expect(at[x.luis]).toBe(x.rpm);
      expect(at[x.maria]).toBe(x.rpm);
      expect(at[x.dave]).toBe(x.greystar);
      expect(at[x.other]).toBe(x.greystar); // not listed: untouched

      const links = await c.query("select contact_id from public.property_contact where property_id = $1", [x.riverside]);
      expect(links.rows.map((r) => r.contact_id).sort()).toEqual([x.luis, x.maria, x.other].sort());

      const jobs = await c.query(
        "select account_id, ended_on is null as current, source from public.contact_employment where contact_id = $1 order by ended_on nulls last",
        [x.luis],
      );
      expect(jobs.rows).toEqual([
        { account_id: x.greystar, current: false, source: "insert" },
        { account_id: x.rpm, current: true, source: "transfer" },
      ]);
      // Their touches still hang off them.
      const luisTouches = await one<{ n: string }>(c, "select count(*) as n from public.touch where contact_id = $1", [x.luis]);
      expect(Number(luisTouches.n)).toBe(2);
    });
  });

  it("puts the intro task at the top of the queue on the next business day", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "xfer3@test.dev");
      const x = await seedRiverside(c, t, rep);
      // Competing work: an overdue P1 bid follow-up worth a lot.
      await c.query(
        "insert into public.task(tenant_id, assignee_user_id, account_id, opportunity_id, kind, title, due_on, priority) values ($1,$2,$3,$4,'follow_up','Chase the bid', current_date - 5, 90)",
        [t, rep, x.greystar, x.openOpp],
      );
      await actAs(c, rep);
      await rpc(c, "transfer_property", { p_property: x.riverside, p_role: "manager", p_new_account: x.rpm });
      const task = await one<{ title: string; due_on: Date; priority: number; kind: string; assignee_user_id: string; property_id: string }>(
        c, "select * from public.task where property_id = $1 and title like 'Intro%'", [x.riverside]);
      expect(task.title).toBe("Intro to new management at Riverside Apartments");
      expect(task.kind).toBe("next_step");
      expect(task.priority).toBe(85);
      expect(task.assignee_user_id).toBe(rep);
      const due = await one<{ ok: boolean; d: string }>(
        c, "select $1::date = app.add_business_days(app.tenant_today($2), 1) as ok, $1::date::text as d", [task.due_on, t]);
      expect(due.ok).toBe(true);

      const q = await c.query("select title, property_id from public.rep_queue($1, $2, $3::date)", [t, rep, due.d]);
      expect(q.rows[0]).toEqual({ title: "Intro to new management at Riverside Apartments", property_id: x.riverside });
    });
  });

  it("changing the owner of a managed building moves no opportunities and keeps the manager as the account", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "xfer4@test.dev");
      const x = await seedRiverside(c, t, rep);
      const owner = await ins(c, "account", { tenant_id: t, name: "Blackstone REIT", account_type: "reit" });
      await actAs(c, rep);
      await rpc(c, "transfer_property", { p_property: x.riverside, p_role: "owner", p_new_account: owner });
      const p = await one<{ account_id: string; current_owner_name: string; current_manager_name: string; ownership_changed_on: string | null }>(
        c, "select account_id, current_owner_name, current_manager_name, ownership_changed_on from public.property_current where id = $1", [x.riverside]);
      expect(p).toEqual({ account_id: x.greystar, current_owner_name: "Blackstone REIT", current_manager_name: "Greystar", ownership_changed_on: null });
      const o = await one<{ account_id: string }>(c, "select account_id from public.opportunity where id = $1", [x.openOpp]);
      expect(o.account_id).toBe(x.greystar);
      const s = await one<{ kind: string; headline: string }>(c, "select kind, headline from public.signal where property_id = $1", [x.riverside]);
      expect(s).toEqual({ kind: "ownership_change", headline: "Riverside Apartments is owned by Blackstone REIT" });
      await expect(rpc(c, "transfer_property", { p_property: x.riverside, p_role: "owner", p_new_account: owner })).rejects.toThrow(/already the owner/);
    });
  });

  it("RLS: a rep cannot transfer another company's property or move it to another company's account", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const foxRep = await makeUser(c, fox, "fox-rep@test.dev");
      const tsgRep = await makeUser(c, tsg, "tsg-rep@test.dev");
      const x = await seedRiverside(c, fox, foxRep);
      const tsgAcct = await ins(c, "account", { tenant_id: tsg, name: "Memphis PMC", owner_user_id: tsgRep });
      await actAs(c, tsgRep);
      await c.query("savepoint a");
      await expect(rpc(c, "transfer_property", { p_property: x.riverside, p_role: "manager", p_new_account: tsgAcct })).rejects.toThrow(/property not found/);
      await c.query("rollback to savepoint a");
      await actAsService(c);
      await actAs(c, foxRep);
      await c.query("savepoint b");
      await expect(rpc(c, "transfer_property", { p_property: x.riverside, p_role: "manager", p_new_account: tsgAcct })).rejects.toThrow(/company not found/);
      await c.query("rollback to savepoint b");
      await actAsService(c);
      const p = await one<{ account_id: string }>(c, "select account_id from public.property where id = $1", [x.riverside]);
      expect(p.account_id).toBe(x.greystar);
      // Direct writes across tenants are blocked too.
      await expect(
        c.query("insert into public.property_party(tenant_id, property_id, account_id, role) values ($1,$2,$3,'owner')", [fox, x.riverside, tsgAcct]),
      ).rejects.toThrow(/same company/);
    });
  });

  it("portfolio move of 3 buildings is atomic: one bad id and nothing changes", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bulk@test.dev");
      const x = await seedRiverside(c, t, rep);
      const p2 = await ins(c, "property", { tenant_id: t, account_id: x.greystar, name: "Eastside Lofts" });
      const p3 = await ins(c, "property", { tenant_id: t, account_id: x.greystar, name: "Domain Flats" });
      await actAs(c, rep);
      await c.query("savepoint bad");
      await expect(
        rpc(c, "transfer_properties", { p_properties: [x.riverside, p2, "00000000-0000-4000-8000-000000000999"], p_role: "manager", p_new_account: x.rpm }),
      ).rejects.toThrow(/property not found/);
      await c.query("rollback to savepoint bad");
      const still = await c.query("select account_id from public.property where id = any($1)", [[x.riverside, p2, p3]]);
      expect(still.rows.every((r) => r.account_id === x.greystar)).toBe(true);
      const hist = await one<{ n: string }>(c, "select count(*) as n from public.property_party where property_id = any($1) and source = 'transfer'", [[x.riverside, p2, p3]]);
      expect(Number(hist.n)).toBe(0);

      const ok = await rpc<{ r: string[] }>(c, "transfer_properties", {
        p_properties: [x.riverside, p2, p3], p_role: "manager", p_new_account: x.rpm, p_contacts_with_building: [x.luis],
      });
      expect(ok.r).toHaveLength(3);
      const moved = await c.query("select account_id from public.property where id = any($1)", [[x.riverside, p2, p3]]);
      expect(moved.rows.every((r) => r.account_id === x.rpm)).toBe(true);
      const intro = await c.query("select title, boost from public.task where account_id = $1 and title like 'Intro%'", [x.rpm]);
      expect(intro.rows).toEqual([{ title: "Intro to RPM Living: 3 properties just moved to them", boost: 100 }]);
      const luis = await one<{ account_id: string }>(c, "select account_id from public.contact where id = $1", [x.luis]);
      expect(luis.account_id).toBe(x.rpm);
    });
  });

  it("a direct write to property.account_id is recorded as history (old edit form, imports)", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "direct@test.dev");
      const x = await seedRiverside(c, t, rep);
      await actAs(c, rep);
      await c.query("update public.property set account_id = $1 where id = $2", [x.rpm, x.riverside]);
      const rows = await c.query(
        "select account_id, ended_on is null as current, source from public.property_party where property_id = $1 order by ended_on nulls last",
        [x.riverside],
      );
      expect(rows.rows).toEqual([
        { account_id: x.greystar, current: false, source: "insert" },
        { account_id: x.rpm, current: true, source: "direct_edit" },
      ]);
      const p = await one<{ account_id: string }>(c, "select account_id from public.property where id = $1", [x.riverside]);
      expect(p.account_id).toBe(x.rpm);
    });
  });
});

describe("follow the people", () => {
  it("move_contact keeps the touch history, records employment and creates a warm reconnect task", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "move@test.dev");
      const x = await seedRiverside(c, t, rep);
      const lincoln = await ins(c, "account", { tenant_id: t, name: "Lincoln Property Co", owner_user_id: rep });
      await actAs(c, rep);
      const before = await c.query("select id from public.touch where contact_id = $1 order by occurred_at", [x.dave]);

      const emp = await rpc<{ r: string }>(c, "move_contact", { p_contact: x.dave, p_new_account: lincoln, p_new_title: "VP Facilities" });
      expect(emp.r).toMatch(/^[0-9a-f-]{36}$/);

      const dave = await one<{ account_id: string; title: string }>(c, "select account_id, title from public.contact where id = $1", [x.dave]);
      expect(dave).toEqual({ account_id: lincoln, title: "VP Facilities" });
      const after = await c.query("select id, account_id from public.touch where contact_id = $1 order by occurred_at", [x.dave]);
      expect(after.rows.map((r) => r.id)).toEqual(before.rows.map((r) => r.id));
      expect(after.rows.every((r) => r.account_id === x.greystar)).toBe(true); // history keeps where it happened

      const jobs = await c.query(
        "select account_id, title, ended_on is null as current from public.contact_employment where contact_id = $1 order by ended_on nulls last",
        [x.dave],
      );
      expect(jobs.rows).toEqual([
        { account_id: x.greystar, title: "Regional Facilities Director", current: false },
        { account_id: lincoln, title: "VP Facilities", current: true },
      ]);
      // No longer the person at the Greystar building.
      const link = await c.query("select 1 from public.property_contact where contact_id = $1", [x.dave]);
      expect(link.rows).toHaveLength(0);

      const task = await one<{ title: string; reason: string; contact_id: string; account_id: string; boost: number }>(
        c, "select title, reason, contact_id, account_id, boost from public.task where contact_id = $1 and status = 'open' and title like 'Reconnect%'", [x.dave]);
      expect(task).toEqual({ title: "Reconnect with Dave Morales at Lincoln Property Co", reason: "Warm lead — you know them from Greystar", contact_id: x.dave, account_id: lincoln, boost: 40 });
      const sig = await one<{ headline: string }>(c, "select headline from public.signal where kind = 'contact_moved' and account_id = $1", [lincoln]);
      expect(sig.headline).toBe("Dave Morales moved from Greystar to Lincoln Property Co");

      await expect(rpc(c, "move_contact", { p_contact: x.dave, p_new_account: lincoln })).rejects.toThrow(/already works at/);
    });
  });

  it("editing a contact's company directly also writes employment history", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "edit@test.dev");
      const x = await seedRiverside(c, t, rep);
      await actAs(c, rep);
      await c.query("update public.contact set account_id = $1 where id = $2", [x.rpm, x.other]);
      const jobs = await c.query("select account_id, source from public.contact_employment where contact_id = $1 order by ended_on nulls last", [x.other]);
      expect(jobs.rows).toEqual([
        { account_id: x.greystar, source: "insert" },
        { account_id: x.rpm, source: "direct_edit" },
      ]);
    });
  });
});

describe("condition flags", () => {
  it("one-tap set/clear keeps history and shows in property_current", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "flag@test.dev");
      const x = await seedRiverside(c, t, rep);
      await actAs(c, rep);
      await rpc(c, "set_property_flag", { p_property: x.riverside, p_flag: "active_leak", p_on: true, p_note: "Unit 204 ceiling" });
      await rpc(c, "set_property_flag", { p_property: x.riverside, p_flag: "active_leak", p_on: true }); // idempotent
      await rpc(c, "set_property_flag", { p_property: x.riverside, p_flag: "ponding", p_on: true });
      let cur = await one<{ active_flags: string[] }>(c, "select active_flags from public.property_current where id = $1", [x.riverside]);
      expect([...cur.active_flags].sort()).toEqual(["active_leak", "ponding"]);

      await rpc(c, "set_property_flag", { p_property: x.riverside, p_flag: "active_leak", p_on: false });
      cur = await one<{ active_flags: string[] }>(c, "select active_flags from public.property_current where id = $1", [x.riverside]);
      expect(cur.active_flags).toEqual(["ponding"]);
      const all = await c.query("select flag, cleared_at is not null as cleared, cleared_by from public.property_flag where property_id = $1 order by flag", [x.riverside]);
      expect(all.rows).toEqual([
        { flag: "active_leak", cleared: true, cleared_by: rep },
        { flag: "ponding", cleared: false, cleared_by: null },
      ]);
      await c.query("savepoint s1");
      await expect(rpc(c, "set_property_flag", { p_property: x.riverside, p_flag: "sinkhole", p_on: true })).rejects.toThrow(/violates check constraint/);
      await c.query("rollback to savepoint s1");
      // Flags are history: reps cannot delete them.
      await expect(c.query("delete from public.property_flag where property_id = $1", [x.riverside])).rejects.toThrow(/permission denied/);
    });
  });

  it("storm signals on the building badge it for 30 days", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "storm@test.dev");
      const x = await seedRiverside(c, t, rep);
      await c.query(
        "insert into public.signal(tenant_id, property_id, kind, headline, source, occurred_at) values ($1,$2,'hail','1.25\" hail', 'agent', now() - interval '2 days')",
        [t, x.riverside],
      );
      await actAs(c, rep);
      const s = await one<{ storm_kind: string }>(c, "select storm_kind from public.property_current where id = $1", [x.riverside]);
      expect(s.storm_kind).toBe("hail");
    });
  });
});
