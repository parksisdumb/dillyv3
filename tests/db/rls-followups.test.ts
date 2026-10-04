// Pins 20261004001200_rls_fast_ownership_and_profile_fix.sql: the ownership tables use the InitPlan RLS pattern with
// unchanged semantics, and profile updates work (no 42P17 recursion) without letting anyone grant themselves admin.
import { describe, expect, it } from "vitest";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

const NEW_TABLES = ["property_party", "contact_employment", "property_flag"];

describe("ownership tables RLS", () => {
  it("select/insert/update policies use app.my_tenant_ids(), not per-row app.is_member()", async () => {
    await inTx(async (c) => {
      const r = await c.query(
        `select tablename, policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
           from pg_policies where tablename = any($1) and cmd in ('SELECT','INSERT','UPDATE')`,
        [NEW_TABLES],
      );
      expect(r.rows.length).toBe(9);
      for (const p of r.rows) {
        expect(p.expr, `${p.tablename}.${p.policyname}`).toContain("my_tenant_ids");
        expect(p.expr, `${p.tablename}.${p.policyname}`).not.toContain("is_member");
      }
    });
  });

  it("a member sees and writes only their tenant's ownership history", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const rep = await makeUser(c, fox, "rls-followup-rep@foxroofing.co");
      const mk = async (t: string, name: string) => {
        const a = await one<{ id: string }>(c, "insert into public.account(tenant_id, name) values ($1,$2) returning id", [t, name]);
        const p = await one<{ id: string }>(c, "insert into public.property(tenant_id, account_id, name) values ($1,$2,'Bldg') returning id", [t, a.id]);
        return { a: a.id, p: p.id };
      };
      const f = await mk(fox, "RLS Fox Co");
      const s = await mk(tsg, "RLS TSG Co");
      await actAs(c, rep);
      const seen = await c.query("select tenant_id from public.property_party where property_id = any($1)", [[f.p, s.p]]);
      expect(seen.rows.map((r) => r.tenant_id)).toEqual([fox]);
      await c.query("savepoint x");
      await expect(
        c.query("insert into public.property_flag(tenant_id, property_id, flag) values ($1,$2,'active_leak')", [tsg, s.p]),
      ).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint x");
      await c.query("insert into public.property_flag(tenant_id, property_id, flag) values ($1,$2,'active_leak')", [fox, f.p]);
      await actAsService(c);
    });
  });
});

describe("profile_update", () => {
  it("a user can update their own profile but not grant themselves platform admin or edit someone else", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const me = await makeUser(c, fox, "rls-profile-me@foxroofing.co");
      const other = await makeUser(c, fox, "rls-profile-other@foxroofing.co");
      await actAs(c, me);
      const r = await c.query("update public.profile set full_name = 'Me Myself', phone = '(512) 555-0110' where id = $1", [me]);
      expect(r.rowCount).toBe(1);
      await c.query("savepoint x");
      await expect(c.query("update public.profile set is_platform_admin = true where id = $1", [me])).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint x");
      const o = await c.query("update public.profile set full_name = 'Hacked' where id = $1", [other]);
      expect(o.rowCount).toBe(0);
      await actAsService(c);
      expect((await one<{ full_name: string }>(c, "select full_name from public.profile where id = $1", [me])).full_name).toBe("Me Myself");
    });
  });
});
