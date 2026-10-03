/**
 * DB-level checks of the SQL the Rep Daily Brief depends on (rep_queue, close_rep_day, rep_streak, brief upsert),
 * run with `pg` against the local agents test DB:
 *   DB=dilly_agents_test ./scripts/local/reset-db.sh
 * Skipped when that database is not reachable.
 */
import { describe, expect, it } from "vitest";
import { Client } from "pg";

const URL = process.env.AGENTS_TEST_DATABASE_URL ?? "postgresql://postgres@localhost:54329/dilly_agents_test?host=/tmp";

async function reachable(): Promise<boolean> {
  const c = new Client({ connectionString: URL });
  try {
    await c.connect();
    await c.query("select 1 from public.agent where key = 'rep-daily-brief'");
    return true;
  } catch {
    return false;
  } finally {
    await c.end().catch(() => {});
  }
}
const available = await reachable();

async function inTx<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: URL });
  await c.connect();
  try {
    await c.query("begin");
    return await fn(c);
  } finally {
    await c.query("rollback").catch(() => {});
    await c.end();
  }
}
async function one<T = Record<string, unknown>>(c: Client, sql: string, p: unknown[] = []): Promise<T> {
  return (await c.query(sql, p)).rows[0] as T;
}
async function seed(c: Client) {
  const t = (await one<{ id: string }>(c, "select id from public.tenant where slug = 'fox'")).id;
  const u = (await one<{ id: string }>(c, "insert into auth.users(email) values ('brief-rep@test.dev') returning id")).id;
  await c.query("insert into public.membership(tenant_id, user_id, role) values ($1,$2,'rep')", [t, u]);
  const a = (await one<{ id: string }>(
    c,
    "insert into public.account(tenant_id, name, account_type, icp_tier, owner_user_id) values ($1,'Greystar','property_mgmt',1,$2) returning id",
    [t, u],
  )).id;
  const ct = (await one<{ id: string }>(
    c,
    "insert into public.contact(tenant_id, account_id, first_name, last_name) values ($1,$2,'Dave','Lopez') returning id",
    [t, a],
  )).id;
  const today = (await one<{ d: string }>(c, "select app.tenant_today($1)::text as d", [t])).d;
  return { t, u, a, ct, today };
}

describe.skipIf(!available)("SQL behind the Rep Daily Brief", () => {
  it("rep_queue returns overdue tasks with overdue_days and tier, and hides do-not-pursue accounts", async () => {
    await inTx(async (c) => {
      const { t, u, a, ct, today } = await seed(c);
      await c.query(
        "insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, title, due_on, priority) values ($1,$2,$3,$4,'Call Dave back', $5::date - 4, 60)",
        [t, u, a, ct, today],
      );
      const rows = (await c.query("select * from public.rep_queue($1,$2,$3)", [t, u, today])).rows;
      const taskRow = rows.find((r) => r.item_type === "task");
      expect(taskRow).toMatchObject({ title: "Call Dave back", overdue_days: 4, icp_tier: 1, account_name: "Greystar" });
      expect(rows.some((r) => r.item_type === "first_touch" && r.account_id === a)).toBe(true);

      await c.query("insert into public.account_preference(tenant_id, account_id, preference) values ($1,$2,'do_not_pursue')", [t, a]);
      const after = (await c.query("select * from public.rep_queue($1,$2,$3)", [t, u, today])).rows;
      expect(after.filter((r) => r.item_type === "task")).toHaveLength(0);
    });
  });

  it("close_rep_day marks a day cleared once the rep touched and nothing is overdue; rep_streak counts it", async () => {
    await inTx(async (c) => {
      const { t, u, ct, today } = await seed(c);
      await c.query("select public.close_rep_day($1, $2::date)", [t, today]);
      expect((await one(c, "select cleared from public.rep_day where tenant_id=$1 and user_id=$2 and day=$3", [t, u, today])).cleared).toBe(false);

      await c.query("insert into public.touch(tenant_id, user_id, contact_id, channel, outcome) values ($1,$2,$3,'call','voicemail')", [t, u, ct]);
      await c.query("select public.close_rep_day($1, $2::date)", [t, today]);
      const day = await one(c, "select touches, overdue_eod, cleared from public.rep_day where tenant_id=$1 and user_id=$2 and day=$3", [t, u, today]);
      expect(day).toMatchObject({ touches: 1, overdue_eod: 0, cleared: true });
      expect((await one<{ s: number }>(c, "select public.rep_streak($1,$2) as s", [t, u])).s).toBeGreaterThanOrEqual(1);
    });
  });

  it("clean_week has a platform point rule; brief upserts on (tenant, user, for_date) and keeps seen_at", async () => {
    await inTx(async (c) => {
      const { t, u, today } = await seed(c);
      expect((await one(c, "select points from public.point_rule where event='clean_week' and tenant_id is null")).points).toBe(5);
      const run = await one<{ id: string }>(
        c,
        "insert into public.agent_run(tenant_id, agent_key, trigger, subject_user_id) values ($1,'rep-daily-brief','cron',$2) returning id",
        [t, u],
      );
      const up = `insert into public.brief(tenant_id,user_id,for_date,headline,lines,queue,agent_run_id) values ($1,$2,$3,$4,'[]','[]',$5)
                  on conflict (tenant_id,user_id,for_date) do update set headline = excluded.headline, agent_run_id = excluded.agent_run_id`;
      await c.query(up, [t, u, today, "first", run.id]);
      await c.query("update public.brief set seen_at = now() where tenant_id=$1 and user_id=$2", [t, u]);
      await c.query(up, [t, u, today, "second", run.id]);
      const b = await one(c, "select headline, seen_at from public.brief where tenant_id=$1 and user_id=$2 and for_date=$3", [t, u, today]);
      expect(b.headline).toBe("second");
      expect(b.seen_at).not.toBeNull();
      await c.query("insert into public.insight(tenant_id, agent_run_id, kind, title, body) values ($1,$2,'reminder','x','y')", [t, run.id]);
    });
  });
});
