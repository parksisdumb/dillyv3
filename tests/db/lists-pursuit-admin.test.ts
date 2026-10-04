import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

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

async function count(c: Client, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await one<{ n: string }>(c, `select count(*) as n from (${sql}) x`, params)).n);
}

async function property(c: Client, t: string, name: string): Promise<string> {
  return (await one<{ id: string }>(c, "insert into public.property(tenant_id, name, address1, city) values ($1,$2,$3,'Memphis') returning id", [t, name, `${Math.floor(Math.random() * 9999)} ${name} Ave`])).id;
}

async function world(c: Client) {
  const fox = await tenantId(c, "fox");
  const tsg = await tenantId(c, "tsg");
  const foxRep = await makeUser(c, fox, "lists-fox-rep@example.com", "rep");
  const foxRep2 = await makeUser(c, fox, "lists-fox-rep2@example.com", "rep");
  const foxMgr = await makeUser(c, fox, "lists-fox-mgr@example.com", "manager");
  const foxAdmin = await makeUser(c, fox, "lists-fox-admin@example.com", "admin");
  const tsgOwner = await makeUser(c, tsg, "lists-tsg-owner@example.com", "owner");
  const tsgRep = await makeUser(c, tsg, "lists-tsg-rep@example.com", "rep");
  const foxProp = await property(c, fox, "Fox Flats");
  const tsgProp = await property(c, tsg, "Poplar Plaza");
  return { fox, tsg, foxRep, foxRep2, foxMgr, foxAdmin, tsgOwner, tsgRep, foxProp, tsgProp };
}

describe("system lists", () => {
  it("are seeded for TSG and FOX: the six smart lists, team-visible", async () => {
    await inTx(async (c) => {
      for (const slug of ["tsg", "fox"]) {
        const t = await tenantId(c, slug);
        const r = await c.query("select system_key, kind, visibility, filter from public.list where tenant_id = $1 and created_from = 'system' order by system_key", [t]);
        expect(r.rows.map((x) => x.system_key)).toEqual(["leaks_damage", "never_touched", "new_mgmt_90", "oldest_quiet", "storm_30", "warranty_12mo"]);
        expect(r.rows.every((x) => x.kind === "smart" && x.visibility === "team")).toBe(true);
      }
    });
  });

  it("are created for a brand-new company (trigger), once", async () => {
    await inTx(async (c) => {
      const t = (await one<{ id: string }>(c, "insert into public.tenant(slug, name) values ('acme-test','Acme Roofing') returning id")).id;
      expect(await count(c, "select 1 from public.list where tenant_id = $1 and created_from = 'system'", [t])).toBe(6);
      await c.query("select app.seed_system_lists($1)", [t]);
      expect(await count(c, "select 1 from public.list where tenant_id = $1 and created_from = 'system'", [t])).toBe(6);
    });
  });

  it("can't be created or deleted by people", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAs(c, w.foxAdmin);
      await fails(c, () => c.query("insert into public.list(tenant_id, name, owner_user_id, created_from, system_key) values ($1,'x',$2,'system','x')", [w.fox, w.foxAdmin]), /row-level security/);
      const r = await c.query("delete from public.list where tenant_id = $1 and created_from = 'system'", [w.fox]);
      expect(r.rowCount).toBe(0);
    });
  });
});

describe("lists RLS", () => {
  it("cross-tenant: list, list_item, list_assignment are invisible and unwritable", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAsService(c);
      const tsgList = (await one<{ id: string }>(c, "insert into public.list(tenant_id, name, owner_user_id, visibility) values ($1,'TSG walk',$2,'team') returning id", [w.tsg, w.tsgOwner])).id;
      await c.query("insert into public.list_item(list_id, tenant_id, property_id) values ($1,$2,$3)", [tsgList, w.tsg, w.tsgProp]);
      await c.query("insert into public.list_assignment(list_id, tenant_id, user_id) values ($1,$2,$3)", [tsgList, w.tsg, w.tsgRep]);

      await actAs(c, w.foxAdmin);
      expect(await count(c, "select 1 from public.list where id = $1", [tsgList])).toBe(0);
      expect(await count(c, "select 1 from public.list_item where list_id = $1", [tsgList])).toBe(0);
      expect(await count(c, "select 1 from public.list_assignment where list_id = $1", [tsgList])).toBe(0);
      expect(await count(c, "select 1 from public.list_property_current where list_id = $1", [tsgList])).toBe(0);
      await fails(c, () => c.query("insert into public.list_item(list_id, tenant_id, property_id) values ($1,$2,$3)", [tsgList, w.tsg, w.tsgProp]), /row-level security|duplicate/);
      await fails(c, () => c.query("insert into public.list(tenant_id, name, owner_user_id) values ($1,'sneaky',$2)", [w.tsg, w.foxAdmin]), /row-level security/);
      // A FOX list can't hold a TSG building.
      const foxList = (await one<{ id: string }>(c, "insert into public.list(tenant_id, name, owner_user_id) values ($1,'Mine',$2) returning id", [w.fox, w.foxAdmin])).id;
      await fails(c, () => c.query("insert into public.list_item(list_id, tenant_id, property_id) values ($1,$2,$3)", [foxList, w.fox, w.tsgProp]), /not in this company/);
      await fails(c, () => c.query("insert into public.list_assignment(list_id, tenant_id, user_id) values ($1,$2,$3)", [foxList, w.fox, w.tsgRep]), /not on this team/);
    });
  });

  it("private lists: owner, managers and assignees see them; other reps don't; reps can't assign", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAs(c, w.foxRep);
      const l = (await one<{ id: string }>(c, "insert into public.list(tenant_id, name, owner_user_id) values ($1,'My walk',$2) returning id", [w.fox, w.foxRep])).id;
      await c.query("insert into public.list_item(list_id, tenant_id, property_id) values ($1,$2,$3)", [l, w.fox, w.foxProp]);
      await fails(c, () => c.query("insert into public.list_assignment(list_id, tenant_id, user_id) values ($1,$2,$3)", [l, w.fox, w.foxRep2]), /row-level security/);
      await actAs(c, w.foxRep2);
      expect(await count(c, "select 1 from public.list where id = $1", [l])).toBe(0);
      expect(await count(c, "select 1 from public.list_item where list_id = $1", [l])).toBe(0);
      await actAs(c, w.foxMgr);
      expect(await count(c, "select 1 from public.list where id = $1", [l])).toBe(1);
      await c.query("insert into public.list_assignment(list_id, tenant_id, user_id, assigned_by) values ($1,$2,$3,$4)", [l, w.fox, w.foxRep2, w.foxMgr]);
      await actAs(c, w.foxRep2);
      expect(await count(c, "select 1 from public.list where id = $1", [l])).toBe(1);
      expect(await count(c, "select 1 from public.list_property_current where list_id = $1", [l])).toBe(1);
      // …but an assignee can't edit someone else's list.
      const del = await c.query("delete from public.list_item where list_id = $1", [l]);
      expect(del.rowCount).toBe(0);
    });
  });

  it("list_from_import makes one static list with created + linked buildings", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAs(c, w.foxMgr);
      const batch = (await one<{ r: string }>(c, "select public.import_begin($1,'memphis book.csv','{}','{}',2) as r", [w.fox])).r;
      const made = await one<{ r: Record<string, string> }>(c, "select public.import_properties($1, $2::jsonb) as r", [
        batch,
        JSON.stringify([{ key: "p1", action: "create", name: "New Tower", address1: "1 New Way", city: "Memphis" }]),
      ]);
      await c.query("select public.import_finish($1,'done','{}')", [batch]);
      const list = (await one<{ r: string }>(c, "select public.list_from_import($1, $2::uuid[]) as r", [batch, [w.foxProp, made.r.p1]])).r;
      const again = (await one<{ r: string }>(c, "select public.list_from_import($1, $2::uuid[]) as r", [batch, [w.foxProp]])).r;
      expect(again).toBe(list);
      const row = await one<{ name: string; kind: string; created_from: string }>(c, "select name, kind, created_from from public.list where id = $1", [list]);
      expect(row).toMatchObject({ kind: "static", created_from: "import" });
      expect(row.name).toMatch(/^Import — memphis book\.csv — /);
      const items = await c.query("select property_id from public.list_item where list_id = $1 order by position", [list]);
      expect(items.rows.map((r) => r.property_id)).toEqual([w.foxProp, made.r.p1]);
      await actAs(c, w.foxRep);
      await fails(c, () => c.query("select public.list_from_import($1, null)", [batch]), /only owners, admins and managers/);
    });
  });
});

describe("active pursuit", () => {
  it("one active row per (property, rep); ending keeps history; idempotent", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAs(c, w.foxRep);
      expect((await one<{ n: number }>(c, "select public.set_pursuit($1::uuid[], 'active') as n", [[w.foxProp]])).n).toBe(1);
      expect((await one<{ n: number }>(c, "select public.set_pursuit($1::uuid[], 'active') as n", [[w.foxProp]])).n).toBe(0);
      expect((await one<{ n: number }>(c, "select public.set_pursuit($1::uuid[], 'dropped', 'went with someone else') as n", [[w.foxProp]])).n).toBe(1);
      expect((await one<{ n: number }>(c, "select public.set_pursuit($1::uuid[], 'active') as n", [[w.foxProp]])).n).toBe(1);
      const rows = await c.query("select status, ended_at is not null as ended, note from public.property_pursuit where property_id = $1 order by started_at, status", [w.foxProp]);
      expect(rows.rows.map((r) => r.status).sort()).toEqual(["active", "dropped"]);
      await fails(c, () => c.query("insert into public.property_pursuit(tenant_id, property_id, user_id) values ($1,$2,$3)", [w.fox, w.foxProp, w.foxRep]), /duplicate key/);
      // A rep can't start a pursuit for a teammate; a manager can.
      await fails(c, () => c.query("select public.set_pursuit($1::uuid[], 'active', null, $2)", [[w.foxProp], w.foxRep2]), /row-level security/);
      await actAs(c, w.foxMgr);
      expect((await one<{ n: number }>(c, "select public.set_pursuit($1::uuid[], 'active', null, $2) as n", [[w.foxProp], w.foxRep2])).n).toBe(1);
    });
  });

  it("cross-tenant: invisible and can't be started on another company's building", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAs(c, w.tsgRep);
      await c.query("select public.set_pursuit($1::uuid[], 'active')", [[w.tsgProp]]);
      await actAs(c, w.foxAdmin);
      expect(await count(c, "select 1 from public.property_pursuit where property_id = $1", [w.tsgProp])).toBe(0);
      // set_pursuit reads the property through RLS: another company's building is simply not there.
      expect((await one<{ n: number }>(c, "select public.set_pursuit($1::uuid[], 'active') as n", [[w.tsgProp]])).n).toBe(0);
      await fails(c, () => c.query("insert into public.property_pursuit(tenant_id, property_id, user_id) values ($1,$2,$3)", [w.fox, w.tsgProp, w.foxAdmin]), /not in this company|row-level security/);
      await fails(c, () => c.query("insert into public.property_pursuit(tenant_id, property_id, user_id) values ($1,$2,$3)", [w.tsg, w.tsgProp, w.foxAdmin]), /row-level security/);
    });
  });
});

describe("admin", () => {
  it("admin_audit: owners/admins write as themselves and read their company only; reps neither", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAs(c, w.foxAdmin);
      await c.query("insert into public.admin_audit(tenant_id, actor_user_id, action, target_user_id, before, after) values ($1,$2,'member.role_changed',$3,'{\"role\":\"rep\"}','{\"role\":\"manager\"}')", [w.fox, w.foxAdmin, w.foxRep]);
      await fails(c, () => c.query("insert into public.admin_audit(tenant_id, actor_user_id, action) values ($1,$2,'forged')", [w.fox, w.foxRep]), /row-level security/);
      await fails(c, () => c.query("insert into public.admin_audit(tenant_id, actor_user_id, action) values ($1,$2,'x')", [w.tsg, w.foxAdmin]), /row-level security/);
      expect(await count(c, "select 1 from public.admin_audit where tenant_id = $1", [w.fox])).toBe(1);
      // Append-only: no update/delete grant at all.
      await fails(c, () => c.query("update public.admin_audit set action = 'edited' where tenant_id = $1", [w.fox]), /permission denied/);
      await fails(c, () => c.query("delete from public.admin_audit where tenant_id = $1", [w.fox]), /permission denied/);
      await actAs(c, w.tsgOwner);
      expect(await count(c, "select 1 from public.admin_audit where tenant_id = $1", [w.fox])).toBe(0);
      await actAs(c, w.foxRep);
      expect(await count(c, "select 1 from public.admin_audit")).toBe(0);
      await fails(c, () => c.query("insert into public.admin_audit(tenant_id, actor_user_id, action) values ($1,$2,'x')", [w.fox, w.foxRep]), /row-level security/);
    });
  });

  it("a company keeps one active owner: no demoting, deactivating or deleting the last one", async () => {
    await inTx(async (c) => {
      const t = (await one<{ id: string }>(c, "insert into public.tenant(slug, name) values ('owner-guard','Owner Guard Co') returning id")).id;
      const o1 = await makeUser(c, t, "guard-owner1@example.com", "owner");
      await fails(c, () => c.query("update public.membership set role = 'admin' where tenant_id = $1 and user_id = $2", [t, o1]), /at least one active owner/);
      await fails(c, () => c.query("update public.membership set active = false where tenant_id = $1 and user_id = $2", [t, o1]), /at least one active owner/);
      await fails(c, () => c.query("delete from public.membership where tenant_id = $1 and user_id = $2", [t, o1]), /at least one active owner/);
      const o2 = await makeUser(c, t, "guard-owner2@example.com", "owner");
      await c.query("update public.membership set role = 'admin' where tenant_id = $1 and user_id = $2", [t, o1]);
      await fails(c, () => c.query("update public.membership set active = false where tenant_id = $1 and user_id = $2", [t, o2]), /at least one active owner/);
      // The guard also holds under RLS (an admin acting through the app).
      await actAs(c, o1);
      await fails(c, () => c.query("update public.membership set role = 'rep' where tenant_id = $1 and user_id = $2", [t, o2]), /at least one active owner/);
      await actAsService(c);
      // Deleting the whole company (or the person) cascades fine.
      await c.query("delete from public.tenant where id = $1", [t]);
      expect(await count(c, "select 1 from public.membership where tenant_id = $1", [t])).toBe(0);
    });
  });

  it("a deactivated member loses access immediately (RLS), and gets it back on reactivation", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAsService(c);
      await c.query("insert into public.account(tenant_id, name, owner_user_id) values ($1,'Deactivation Co',$2)", [w.fox, w.foxRep]);
      await actAs(c, w.foxRep);
      expect(await count(c, "select 1 from public.account where tenant_id = $1", [w.fox])).toBeGreaterThan(0);
      expect(await count(c, "select 1 from public.property where id = $1", [w.foxProp])).toBe(1);
      await actAs(c, w.foxAdmin);
      await c.query("update public.membership set active = false where tenant_id = $1 and user_id = $2", [w.fox, w.foxRep]);
      await actAs(c, w.foxRep);
      expect(await count(c, "select 1 from public.account where tenant_id = $1", [w.fox])).toBe(0);
      expect(await count(c, "select 1 from public.property where id = $1", [w.foxProp])).toBe(0);
      expect(await count(c, "select 1 from public.tenant where id = $1", [w.fox])).toBe(0);
      await fails(c, () => c.query("insert into public.account(tenant_id, name) values ($1,'still here?')", [w.fox]), /row-level security/);
      // Their accounts stay put.
      await actAsService(c);
      expect(await count(c, "select 1 from public.account where tenant_id = $1 and owner_user_id = $2", [w.fox, w.foxRep])).toBe(1);
      await actAs(c, w.foxAdmin);
      await c.query("update public.membership set active = true where tenant_id = $1 and user_id = $2", [w.fox, w.foxRep]);
      await actAs(c, w.foxRep);
      expect(await count(c, "select 1 from public.account where tenant_id = $1", [w.fox])).toBeGreaterThan(0);
    });
  });

  it("tenant_member_activity is for managers and up", async () => {
    await inTx(async (c) => {
      const w = await world(c);
      await actAsService(c);
      await c.query("update auth.users set last_sign_in_at = now() - interval '2 hours' where id = $1", [w.foxRep]);
      await actAs(c, w.foxMgr);
      const r = await c.query("select * from public.tenant_member_activity($1) where user_id = $2", [w.fox, w.foxRep]);
      expect(r.rows[0].last_sign_in_at).toBeTruthy();
      await actAs(c, w.foxRep);
      await fails(c, () => c.query("select * from public.tenant_member_activity($1)", [w.fox]), /only owners, admins and managers/);
      await actAs(c, w.tsgOwner);
      await fails(c, () => c.query("select * from public.tenant_member_activity($1)", [w.fox]), /only owners, admins and managers/);
    });
  });
});
