import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";
import { normalizeAddress, normalizeName } from "@/lib/domain/import/rows";

async function rpc<T = unknown>(c: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const names = Object.keys(args);
  const r = await one<{ r: T }>(c, `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(", ")}) as r`, Object.values(args).map((v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? JSON.stringify(v) : Array.isArray(v) && v.length && typeof v[0] === "object" ? JSON.stringify(v) : v)));
  return r.r;
}

/** Run a statement that must fail, inside a savepoint so the test transaction survives. */
async function fails(c: Client, run: () => Promise<unknown>, re: RegExp) {
  await c.query("savepoint x");
  let err: Error | null = null;
  try {
    await run();
  } catch (e) {
    err = e as Error;
  }
  await c.query("rollback to savepoint x");
  expect(err?.message ?? "no error").toMatch(re);
}

type Ids = Record<string, string>;

/** A typical flat import: 2 new companies + 1 existing, 3 contacts (1 existing), 3 properties (1 owner-role). */
async function runImport(c: Client, t: string, mgr: string, rep: string, existing: { acct: string; contact: string }) {
  await actAs(c, mgr);
  const batch = await rpc<string>(c, "import_begin", { p_tenant: t, p_file_name: "memphis.csv", p_mapping: { "0": "account_name" }, p_options: {}, p_row_count: 4 });
  const accts = await rpc<Ids>(c, "import_accounts", {
    p_batch: batch,
    p_rows: [
      { key: "a:bluff", action: "create", name: "Bluff City Residential", account_type: "property_mgmt", icp_tier: 2, owner_user_id: rep },
      { key: "a:cotton", action: "create", name: "Cotton Row Holdings", owner_user_id: null },
      { key: "a:old", action: "link", id: existing.acct, name: "Existing Co" },
    ],
  });
  const cons = await rpc<Ids>(c, "import_contacts", {
    p_batch: batch,
    p_rows: [
      { key: "c:dana", action: "create", account_id: accts["a:bluff"], first_name: "Dana", last_name: "Whitfield", title: "Regional Manager", email: "Dana.W@Example.com" },
      { key: "c:grant", action: "create", account_id: accts["a:cotton"], first_name: "Grant", last_name: "Fairbanks", email: null, phone: "(901) 555-0121" },
      { key: "c:old", action: "link", id: existing.contact, account_id: accts["a:old"] },
    ],
  });
  const props = await rpc<Ids>(c, "import_properties", {
    p_batch: batch,
    p_rows: [
      { key: "p:overton", action: "create", account_id: accts["a:bluff"], party_role: "manager", name: "Overton Flats", address1: "1820 Madison Ave", city: "Memphis", roof_system: "TPO", roof_install_year: 2009, roof_area_sf: 48500, unit_count: 212, contact_ids: [cons["c:dana"]] },
      { key: "p:front", action: "create", account_id: accts["a:cotton"], party_role: "owner", name: "Front Street Exchange", address1: "92 S Front St", city: "Memphis", contact_ids: [cons["c:grant"]] },
      { key: "p:third", action: "create", account_id: accts["a:old"], party_role: "manager", name: "Old Co Annex", address1: "1 Annex Way", city: "Memphis", contact_ids: [cons["c:old"]] },
    ],
  });
  const counts = await rpc<Record<string, number>>(c, "import_finish", { p_batch: batch, p_status: "done", p_counts: { accounts_linked: 1, contacts_linked: 1 } });
  return { batch, accts, cons, props, counts };
}

async function seedExisting(c: Client, t: string, rep: string) {
  const acct = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id) values ($1,'Existing Co',$2) returning id", [t, rep])).id;
  const contact = (await one<{ id: string }>(c, "insert into public.contact(tenant_id, account_id, first_name, last_name) values ($1,$2,'Eve','Existing') returning id", [t, acct])).id;
  return { acct, contact };
}

describe("CSV import commit", () => {
  it("creates tagged rows, owner assignment, property_party rows and contact links; counts come from the database", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const mgr = await makeUser(c, t, "imp-mgr@test.dev", "manager");
      const rep = await makeUser(c, t, "imp-rep@test.dev", "rep");
      const ex = await seedExisting(c, t, rep);
      const r = await runImport(c, t, mgr, rep, ex);
      expect(r.accts["a:old"]).toBe(ex.acct);
      expect(r.cons["c:old"]).toBe(ex.contact);

      const accts = await c.query("select name, owner_user_id, icp_tier, source, import_batch_id, created_by from public.account where import_batch_id = $1 order by name", [r.batch]);
      expect(accts.rows).toEqual([
        { name: "Bluff City Residential", owner_user_id: rep, icp_tier: 2, source: "import", import_batch_id: r.batch, created_by: mgr },
        { name: "Cotton Row Holdings", owner_user_id: null, icp_tier: 3, source: "import", import_batch_id: r.batch, created_by: mgr },
      ]);
      const dana = await one<{ email: string; account_id: string }>(c, "select email::text, account_id from public.contact where id = $1", [r.cons["c:dana"]]);
      expect(dana).toEqual({ email: "dana.w@example.com", account_id: r.accts["a:bluff"] });
      // Employment history row from the existing trigger.
      expect((await one<{ source: string }>(c, "select source from public.contact_employment where contact_id = $1", [r.cons["c:dana"]])).source).toBe("import");

      const party = await c.query(
        "select p.name, pp.role, pp.account_id, pp.source, p.account_id as prop_account, p.unit_count from public.property p join public.property_party pp on pp.property_id = p.id and pp.ended_on is null where p.import_batch_id = $1 order by p.name",
        [r.batch],
      );
      expect(party.rows).toEqual([
        { name: "Front Street Exchange", role: "owner", account_id: r.accts["a:cotton"], source: "import", prop_account: r.accts["a:cotton"], unit_count: null },
        { name: "Old Co Annex", role: "manager", account_id: ex.acct, source: "import", prop_account: ex.acct, unit_count: null },
        { name: "Overton Flats", role: "manager", account_id: r.accts["a:bluff"], source: "import", prop_account: r.accts["a:bluff"], unit_count: 212 },
      ]);
      const links = await one<{ n: string }>(c, "select count(*) as n from public.property_contact where import_batch_id = $1", [r.batch]);
      expect(Number(links.n)).toBe(3);
      expect(r.counts).toMatchObject({ accounts_created: 2, contacts_created: 2, properties_created: 3, links_created: 3, accounts_linked: 1 });
      const b = await one<{ status: string; user_id: string }>(c, "select status, user_id from public.import_batch where id = $1", [r.batch]);
      expect(b).toEqual({ status: "done", user_id: mgr });
    });
  });

  it("re-checks dedupe keys at commit and a retried chunk doesn't double rows", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const mgr = await makeUser(c, t, "imp-mgr2@test.dev", "manager");
      await actAsService(c);
      const already = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'Wolf River Commercial, LLC') returning id", [t])).id;
      await actAs(c, mgr);
      const batch = await rpc<string>(c, "import_begin", { p_tenant: t, p_file_name: "x.csv", p_mapping: {}, p_options: {}, p_row_count: 1 });
      const a = await rpc<Ids>(c, "import_accounts", { p_batch: batch, p_rows: [{ key: "k", action: "create", name: "Wolf River Commercial" }] });
      expect(a.k).toBe(already); // linked, not duplicated
      const rows = [{ key: "c", action: "create", account_id: already, first_name: "Paige", last_name: "Stanfield", email: "paige@example.com" }];
      const c1 = await rpc<Ids>(c, "import_contacts", { p_batch: batch, p_rows: rows });
      const c2 = await rpc<Ids>(c, "import_contacts", { p_batch: batch, p_rows: rows });
      expect(c2.c).toBe(c1.c);
      const p = [{ key: "p", action: "create", account_id: already, name: "Poplar Plaza", address1: "5100 Poplar Avenue", city: "Memphis" }];
      const p1 = await rpc<Ids>(c, "import_properties", { p_batch: batch, p_rows: p });
      const p2 = await rpc<Ids>(c, "import_properties", { p_batch: batch, p_rows: [{ ...p[0], address1: "5100 Poplar Ave" }] });
      expect(p2.p).toBe(p1.p);
    });
  });

  it("TypeScript normalizers agree with the SQL ones", async () => {
    await inTx(async (c) => {
      const names = ["The Bluff City Co., Inc.", "Smith Co Holdings", "Wolf River Commercial, LLC", "  A&B  Partners LP ", "Mid-South Storage Partners", "O'Neil Corp."];
      for (const n of names) {
        const r = await one<{ v: string | null }>(c, "select app.normalize_name($1) as v", [n]);
        expect(normalizeName(n), n).toBe(r.v);
      }
      const addrs: [string, string][] = [["1820 Madison Avenue", "Memphis"], ["300 Harbor Town Blvd.", "MEMPHIS"], ["4100 E. Shelby Drive, Suite 2", "Memphis"]];
      for (const [a, city] of addrs) {
        const r = await one<{ v: string | null }>(c, "select app.normalize_address($1, $2) as v", [a, city]);
        expect(normalizeAddress(a, city)).toBe(r.v);
      }
    });
  });

  it("reps can't import, link across tenants, or assign someone off the team", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const fox = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "imp-rep2@test.dev", "rep");
      const mgr = await makeUser(c, t, "imp-mgr3@test.dev", "manager");
      const outsider = await makeUser(c, fox, "imp-fox@test.dev", "rep");
      const foxAcct = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'Fox Only Co') returning id", [fox])).id;
      await actAs(c, rep);
      await fails(c, () => rpc(c, "import_begin", { p_tenant: t, p_file_name: "x", p_mapping: {}, p_options: {}, p_row_count: 1 }), /only owners, admins and managers/);
      await actAsService(c);
      await actAs(c, mgr);
      const batch = await rpc<string>(c, "import_begin", { p_tenant: t, p_file_name: "x", p_mapping: {}, p_options: {}, p_row_count: 1 });
      await fails(c, () => rpc(c, "import_accounts", { p_batch: batch, p_rows: [{ key: "k", action: "link", id: foxAcct, name: "x" }] }), /no longer exists/);
      await fails(c, () => rpc(c, "import_accounts", { p_batch: batch, p_rows: [{ key: "k", action: "create", name: "New Co", owner_user_id: outsider }] }), /not on this team/);
      await fails(c, () => rpc(c, "import_contacts", { p_batch: batch, p_rows: [{ key: "k", action: "create", account_id: foxAcct, first_name: "X" }] }), /not in this tenant/);
      // A rep in the same tenant can't write into the manager's batch.
      await actAsService(c);
      await actAs(c, rep);
      await fails(c, () => rpc(c, "import_accounts", { p_batch: batch, p_rows: [] }), /only owners|import not found/);
    });
  });
});

describe("CSV import undo", () => {
  it("deletes everything the batch created when nothing was attached since", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const mgr = await makeUser(c, t, "undo-mgr@test.dev", "manager");
      const rep = await makeUser(c, t, "undo-rep@test.dev", "rep");
      const ex = await seedExisting(c, t, rep);
      const r = await runImport(c, t, mgr, rep, ex);
      const report = await rpc<{ deleted: Record<string, number>; kept: Record<string, unknown[]> }>(c, "import_undo", { p_batch: r.batch });
      expect(report.deleted).toEqual({ accounts: 2, contacts: 2, properties: 3, links: 3 });
      expect(report.kept).toEqual({ accounts: [], contacts: [], properties: [] });
      const left = await one<{ a: string; c: string; p: string; party: string }>(
        c,
        `select (select count(*) from public.account where import_batch_id = $1) as a, (select count(*) from public.contact where import_batch_id = $1) as c,
                (select count(*) from public.property where import_batch_id = $1) as p,
                (select count(*) from public.property_party where account_id = any($2)) as party`,
        [r.batch, [r.accts["a:bluff"], r.accts["a:cotton"]]],
      );
      expect(left).toEqual({ a: "0", c: "0", p: "0", party: "0" });
      // Pre-existing records are untouched, including the link that existed before.
      expect((await one<{ n: string }>(c, "select count(*) as n from public.contact where id = $1", [ex.contact])).n).toBe("1");
      expect((await one<{ status: string }>(c, "select status from public.import_batch where id = $1", [r.batch])).status).toBe("undone");
      await fails(c, () => rpc(c, "import_undo", { p_batch: r.batch }), /already undone/);
    });
  });

  it("keeps records with activity since (and their company) and reports them", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const mgr = await makeUser(c, t, "undo-mgr2@test.dev", "manager");
      const rep = await makeUser(c, t, "undo-rep2@test.dev", "rep");
      const ex = await seedExisting(c, t, rep);
      const r = await runImport(c, t, mgr, rep, ex);
      // Kayla-style follow-through after the import: a touch on Dana and a task on Front Street Exchange.
      await actAsService(c);
      await c.query("insert into public.touch(tenant_id, user_id, contact_id, channel, outcome) values ($1,$2,$3,'call','connected')", [t, rep, r.cons["c:dana"]]);
      await c.query("insert into public.task(tenant_id, assignee_user_id, property_id, title, due_on) values ($1,$2,$3,'Walk roof', current_date)", [t, rep, r.props["p:front"]]);
      await actAs(c, mgr);
      const report = await rpc<{ deleted: Record<string, number>; kept: Record<string, { name: string }[]> }>(c, "import_undo", { p_batch: r.batch });
      expect(report.kept.contacts.map((x) => x.name)).toEqual(["Dana Whitfield"]);
      expect(report.kept.properties.map((x) => x.name)).toEqual(["Front Street Exchange"]);
      // Bluff City has Dana's touch (account_id filled from the contact); Cotton Row still owns Front Street.
      expect(report.kept.accounts.map((x) => x.name).sort()).toEqual(["Bluff City Residential", "Cotton Row Holdings"]);
      expect(report.deleted).toEqual({ accounts: 0, contacts: 1, properties: 2, links: 3 });
      expect((await one<{ status: string }>(c, "select status from public.import_batch where id = $1", [r.batch])).status).toBe("partially_undone");
    });
  });

  it("only within 24 hours, and not by reps", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const mgr = await makeUser(c, t, "undo-mgr3@test.dev", "manager");
      const rep = await makeUser(c, t, "undo-rep3@test.dev", "rep");
      const ex = await seedExisting(c, t, rep);
      const r = await runImport(c, t, mgr, rep, ex);
      await actAsService(c);
      await actAs(c, rep);
      await fails(c, () => rpc(c, "import_undo", { p_batch: r.batch }), /only owners, admins and managers/);
      await actAsService(c);
      await c.query("update public.import_batch set created_at = now() - interval '25 hours' where id = $1", [r.batch]);
      await actAs(c, mgr);
      await fails(c, () => rpc(c, "import_undo", { p_batch: r.batch }), /within 24 hours/);
    });
  });
});

describe("bulk assign / reassign", () => {
  it("moves the account, its previous owner's and unassigned open tasks follow; others' tasks stay; audit rows written", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const mgr = await makeUser(c, t, "ba-mgr@test.dev", "manager");
      const colby = await makeUser(c, t, "ba-colby@test.dev", "rep");
      const kayla = await makeUser(c, t, "ba-kayla@test.dev", "rep");
      const other = await makeUser(c, t, "ba-other@test.dev", "rep");
      const a1 = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id, icp_tier) values ($1,'BA One',$2,3) returning id", [t, colby])).id;
      const a2 = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id, icp_tier) values ($1,'BA Two',$2,3) returning id", [t, colby])).id;
      const con = (await one<{ id: string }>(c, "insert into public.contact(tenant_id, account_id, first_name) values ($1,$2,'Pat') returning id", [t, a1])).id;
      const task = async (assignee: string | null, acct: string | null, contact: string | null = null, status = "open") =>
        (await one<{ id: string }>(c, "insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, title, due_on, status) values ($1,$2,$3,$4,'T',current_date,$5) returning id", [t, assignee, acct, contact, status])).id;
      const tColby = await task(colby, a1);
      const tNull = await task(null, a2);
      const tContact = await task(colby, null, con);
      const tOther = await task(other, a1);
      const tDone = await task(colby, a1, null, "done");

      await actAs(c, colby);
      await fails(c, () => rpc(c, "bulk_update_accounts", { p_tenant: t, p_accounts: [a1], p_changes: { owner_user_id: kayla } }), /only owners, admins and managers/);
      await actAsService(c);
      await actAs(c, mgr);
      const res = await rpc<{ accounts: number; tasks_moved: number }>(c, "bulk_update_accounts", { p_tenant: t, p_accounts: [a1, a2], p_changes: { owner_user_id: kayla, icp_tier: 1 } });
      expect(res).toEqual({ accounts: 2, tasks_moved: 3 });

      const owners = await c.query("select id, owner_user_id, icp_tier from public.account where id = any($1)", [[a1, a2]]);
      for (const o of owners.rows) expect(o).toMatchObject({ owner_user_id: kayla, icp_tier: 1 });
      const tasks = await c.query("select id, assignee_user_id from public.task where id = any($1)", [[tColby, tNull, tContact, tOther, tDone]]);
      const who = Object.fromEntries(tasks.rows.map((r) => [r.id, r.assignee_user_id]));
      expect(who[tColby]).toBe(kayla);
      expect(who[tNull]).toBe(kayla);
      expect(who[tContact]).toBe(kayla);
      expect(who[tOther]).toBe(other);
      expect(who[tDone]).toBe(colby);

      const log = await c.query("select account_id, field, old_value, new_value, tasks_moved, changed_by from public.account_change where account_id = $1 order by field", [a1]);
      expect(log.rows).toEqual([
        { account_id: a1, field: "owner", old_value: colby, new_value: kayla, tasks_moved: 2, changed_by: mgr },
        { account_id: a1, field: "tier", old_value: "3", new_value: "1", tasks_moved: 0, changed_by: mgr },
      ]);
      // Kayla's queue now has the moved tasks.
      const q = await c.query("select task_id from public.rep_queue($1, $2) where item_type = 'task'", [t, kayla]);
      expect(q.rows.map((r) => r.task_id).sort()).toEqual([tColby, tNull, tContact].sort());
    });
  });

  it("sets preferences in bulk (with a reason for do-not-pursue) and rejects bad input", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const mgr = await makeUser(c, t, "bp-mgr@test.dev", "manager");
      const fox2 = await tenantId(c, "tsg");
      const a = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'BP One') returning id", [t])).id;
      const foreign = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,'Other Tenant Co') returning id", [fox2])).id;
      await actAs(c, mgr);
      await fails(c, () => rpc(c, "bulk_update_accounts", { p_tenant: t, p_accounts: [a], p_changes: { preference: "do_not_pursue" } }), /say why/);
      await fails(c, () => rpc(c, "bulk_update_accounts", { p_tenant: t, p_accounts: [a], p_changes: { icp_tier: 7 } }), /P1–P4/);
      const r = await rpc<{ accounts: number }>(c, "bulk_update_accounts", { p_tenant: t, p_accounts: [a, foreign], p_changes: { preference: "do_not_pursue", reason: "Self-performs roofing" } });
      expect(r.accounts).toBe(1); // the other tenant's account is ignored
      expect(await one(c, "select preference, reason from public.account_preference where account_id = $1", [a])).toEqual({ preference: "do_not_pursue", reason: "Self-performs roofing" });
      await rpc(c, "bulk_update_accounts", { p_tenant: t, p_accounts: [a], p_changes: { preference: "none" } });
      expect((await c.query("select 1 from public.account_preference where account_id = $1", [a])).rowCount).toBe(0);
      const log = await c.query("select old_value, new_value, note from public.account_change where account_id = $1 and field = 'preference' order by changed_at, id", [a]);
      expect(log.rows).toContainEqual({ old_value: null, new_value: "do_not_pursue", note: "Self-performs roofing" });
      expect(log.rows).toContainEqual({ old_value: "do_not_pursue", new_value: null, note: null });
    });
  });
});

describe("team_scorecard", () => {
  it("counts qualified meetings, in-person, first touches, follow-ups and paperwork per rep, by week and month", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const rep = await makeUser(c, t, "sc-rep@test.dev", "rep");
      const acct = (await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id) values ($1,'SC Co',$2) returning id", [t, rep])).id;
      const touch = (channel: string, outcome: string) =>
        c.query("insert into public.touch(tenant_id, user_id, account_id, channel, outcome, skip_follow_up) values ($1,$2,$3,$4,$5,true)", [t, rep, acct, channel, outcome]);
      await touch("call", "scheduled_inspection"); // meeting (first touch)
      await touch("site_visit", "met_decision_maker"); // meeting + in person
      await touch("roof_walk", "met_in_person"); // meeting + in person
      await touch("meeting", "not_there"); // in person only
      await touch("door_knock", "gatekeeper"); // in person only
      await touch("call", "voicemail"); // nothing
      await c.query("insert into public.touch(tenant_id, user_id, account_id, channel, outcome, voided_at) values ($1,$2,$3,'meeting','met_decision_maker', now())", [t, rep, acct]);
      await c.query("insert into public.task(tenant_id, assignee_user_id, account_id, title, due_on, status) values ($1,$2,$3,'a',app.tenant_today($1),'done'),($1,$2,$3,'b',app.tenant_today($1),'open'),($1,$2,$3,'c',app.tenant_today($1),'dropped')", [t, rep, acct]);
      await c.query("update public.account set onboarding_status = 'paperwork_received' where id = $1", [acct]);
      const stamped = await one<{ at: string | null }>(c, "select paperwork_at as at from public.account where id = $1", [acct]);
      expect(stamped.at).not.toBeNull();
      // Going further keeps the first date.
      await c.query("update public.account set onboarding_status = 'compliant' where id = $1", [acct]);
      expect((await one<{ at: string }>(c, "select paperwork_at as at from public.account where id = $1", [acct])).at).toEqual(stamped.at);

      const rows = await c.query("select bucket, meetings, in_person, first_touches, fu_due, fu_done, paperwork from public.team_scorecard($1, 13) where user_id = $2 order by bucket", [t, rep]);
      const want = { meetings: 3, in_person: 4, first_touches: 1, fu_due: 2, fu_done: 1, paperwork: 1 };
      expect(rows.rows).toEqual([
        { bucket: "month", ...want },
        { bucket: "week", ...want },
      ]);
    });
  });
});
