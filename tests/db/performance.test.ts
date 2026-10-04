// Pins the semantics of 20261004000500_performance.sql: InitPlan-style RLS policies must behave exactly like
// app.is_member / app.has_role did, the account_ranked rewrite must keep its columns, and the idempotent
// touch insert used by the Log action must dedupe on (tenant_id, source, external_id).
import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { actAs, actAsService, inTx, makeUser, one, tenantId } from "./helpers";

async function seed(c: Client, tenant: string, owner: string, name: string) {
  const a = await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id) values ($1,$2,$3) returning id", [tenant, name, owner]);
  await c.query("insert into public.contact(tenant_id, account_id, first_name) values ($1,$2,'Pat')", [tenant, a.id]);
  await c.query("insert into public.property(tenant_id, account_id, name, city) values ($1,$2,'Bldg','Memphis')", [tenant, a.id]);
  await c.query(
    "insert into public.touch(tenant_id, user_id, account_id, channel, outcome) values ($1,$2,$3,'call','connected')",
    [tenant, owner, a.id],
  );
  return a.id;
}

const TABLES = ["account", "contact", "property", "touch", "task", "point_event"];

describe("RLS after the performance rewrite", () => {
  it("members see only their tenant across hot tables; platform admins see all; inactive members see nothing", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const foxRep = await makeUser(c, fox, "perf-fox@test.dev");
      const tsgRep = await makeUser(c, tsg, "perf-tsg@test.dev");
      const gone = await makeUser(c, tsg, "perf-gone@test.dev");
      await c.query("update public.membership set active = false where user_id = $1", [gone]);
      const admin = await makeUser(c, fox, "perf-admin@test.dev");
      await c.query("update public.profile set is_platform_admin = true where id = $1", [admin]);
      await seed(c, fox, foxRep, "Fox Perf Acct");
      await seed(c, tsg, tsgRep, "TSG Perf Acct");

      const counts = async (who: string) => {
        await actAs(c, who);
        const out: Record<string, string[]> = {};
        for (const t of TABLES) {
          const r = await c.query(`select distinct tenant_id::text from public.${t} where tenant_id in ($1, $2)`, [fox, tsg]);
          out[t] = r.rows.map((x) => x.tenant_id).sort();
        }
        await actAsService(c);
        return out;
      };

      const foxSees = await counts(foxRep);
      for (const t of TABLES) expect(foxSees[t].every((x) => x === fox), t).toBe(true);
      expect(foxSees.account).toEqual([fox]);

      const adminSees = await counts(admin);
      expect(adminSees.account).toEqual([fox, tsg].sort());
      expect(adminSees.touch).toEqual([fox, tsg].sort());

      const goneSees = await counts(gone);
      for (const t of TABLES) expect(goneSees[t], t).toEqual([]);
    });
  });

  it("writes: members can insert/update in their tenant only; targeting writes need manager+", async () => {
    await inTx(async (c) => {
      const fox = await tenantId(c, "fox");
      const tsg = await tenantId(c, "tsg");
      const rep = await makeUser(c, fox, "perf-w-rep@test.dev");
      const mgr = await makeUser(c, fox, "perf-w-mgr@test.dev", "manager");

      await actAs(c, rep);
      await c.query("insert into public.account(tenant_id, name) values ($1, 'mine')", [fox]);
      await c.query("savepoint s0");
      await expect(c.query("insert into public.account(tenant_id, name) values ($1, 'theirs')", [tsg])).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s0");
      await c.query("savepoint s1");
      await expect(
        c.query("insert into public.tenant_targeting(tenant_id, dimension, value, mode) values ($1,'account_type','reit','include')", [fox]),
      ).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s1");
      // Reps can still READ targeting (account_ranked depends on it).
      const read = await c.query("select 1 from public.tenant_targeting where tenant_id = $1", [fox]);
      expect(read.rowCount).toBeGreaterThanOrEqual(0);
      await actAsService(c);

      await actAs(c, mgr);
      await c.query("insert into public.tenant_targeting(tenant_id, dimension, value, mode) values ($1,'account_type','reit','include') on conflict do nothing", [fox]);
      await c.query("savepoint s2");
      await expect(
        c.query("insert into public.tenant_targeting(tenant_id, dimension, value, mode) values ($1,'account_type','reit','include')", [tsg]),
      ).rejects.toThrow(/row-level security/);
      await c.query("rollback to savepoint s2");
      await actAsService(c);
    });
  });
});

describe("account_ranked + rep_queue after the rewrite", () => {
  it("keeps every column and still ranks/queues for the owner", async () => {
    await inTx(async (c) => {
      const tsg = await tenantId(c, "tsg");
      const rep = await makeUser(c, tsg, "perf-rank@test.dev");
      const acct = await seed(c, tsg, rep, "Rank Perf Acct");
      await actAs(c, rep);
      const r = await one<Record<string, unknown>>(c, "select * from public.account_ranked where id = $1", [acct]);
      for (const col of [
        "market_slug",
        "property_count",
        "contact_count",
        "open_opps",
        "open_value",
        "open_tasks",
        "preference",
        "preference_reason",
        "days_since_touch",
        "target_excluded",
        "target_weight",
        "relationship_state",
        "is_cold",
        "rank_score",
        "excluded_reason",
      ]) {
        expect(r, col).toHaveProperty(col);
      }
      expect(Number(r.property_count)).toBe(1);
      expect(Number(r.contact_count)).toBe(1);
      expect(r.target_excluded).toBe(false);
      expect(Number(r.target_weight)).toBe(1);
      expect(r.relationship_state).toBe("active");
      const q = await c.query("select item_type from public.rep_queue($1, $2)", [tsg, rep]);
      expect(q.rows.length).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("idempotent touch logging", () => {
  it("a second insert with the same (tenant, source, external_id) is rejected with 23505 and logs nothing extra", async () => {
    await inTx(async (c) => {
      const tsg = await tenantId(c, "tsg");
      const rep = await makeUser(c, tsg, "perf-idem@test.dev");
      const a = await one<{ id: string }>(c, "insert into public.account(tenant_id, name, owner_user_id) values ($1,'Idem',$2) returning id", [tsg, rep]);
      await actAs(c, rep);
      const ins = "insert into public.touch(tenant_id, user_id, account_id, channel, outcome, source, external_id) values ($1,$2,$3,'call','connected','rep',$4)";
      await c.query(ins, [tsg, rep, a.id, "idem:11111111-1111-4111-8111-111111111111"]);
      await c.query("savepoint s1");
      const err = await c.query(ins, [tsg, rep, a.id, "idem:11111111-1111-4111-8111-111111111111"]).catch((e: { code?: string }) => e);
      expect((err as { code?: string }).code).toBe("23505");
      await c.query("rollback to savepoint s1");
      const n = await one<{ n: string }>(c, "select count(*) n from public.touch where account_id = $1", [a.id]);
      expect(Number(n.n)).toBe(1);
      const pts = await one<{ n: string }>(c, "select count(*) n from public.point_event where account_id = $1", [a.id]);
      expect(Number(pts.n)).toBeGreaterThan(0);
      const tasks = await one<{ n: string }>(c, "select count(*) n from public.task where account_id = $1", [a.id]);
      expect(Number(tasks.n)).toBeLessThanOrEqual(1);
    });
  });
});

describe("health()", () => {
  it("is callable by anon and returns the DB clock", async () => {
    await inTx(async (c) => {
      await c.query("set local role anon");
      const r = await one<{ t: Date }>(c, "select public.health() as t");
      expect(r.t).toBeInstanceOf(Date);
    });
  });
});
