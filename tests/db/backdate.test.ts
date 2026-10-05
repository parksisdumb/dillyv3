/**
 * Post-dated (backfilled) touches and the Condo/HOA management account type
 * (supabase/migrations/20261005000100_backdate_and_condo_hoa.sql).
 */
import { describe, expect, it } from "vitest";
import type { Client } from "pg";
import { inTx, makeUser, one, tenantId } from "./helpers";

async function seed(c: Client, tenant: string, owner: string) {
  const a = await one<{ id: string }>(c, "insert into public.account(tenant_id, name, account_type, icp_tier, owner_user_id) values ($1,'Backfill Co','property_mgmt',2,$2) returning id", [tenant, owner]);
  const ct = await one<{ id: string }>(c, "insert into public.contact(tenant_id, account_id, first_name, last_name, persona_role) values ($1,$2,'Rita','Gomez','evaluator') returning id", [tenant, a.id]);
  return { account: a.id, contact: ct.id };
}

async function touch(c: Client, t: Record<string, unknown>) {
  const cols = Object.keys(t);
  return one<{ id: string }>(c, `insert into public.touch(${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")}) returning id`, Object.values(t));
}

/** A timestamp `days` days before the transaction's now(), at 10:00 tenant-local (so the local day is unambiguous). */
async function daysAgoAt10(c: Client, tenant: string, days: number): Promise<string> {
  const r = await one<{ at: Date }>(
    c,
    "select ((app.tenant_today($1) - $2::int)::timestamp + time '10:00') at time zone (select timezone from public.tenant where id = $1) as at",
    [tenant, days],
  );
  return r.at.toISOString();
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

describe("backfilled touches", () => {
  it("a backdated voicemail schedules its follow-up for today, not already overdue", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd1@test.dev");
      const { contact } = await seed(c, t, rep);
      const at = await daysAgoAt10(c, t, 10);
      const tc = await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail", occurred_at: at });
      const k = await one<{ due_on: Date; today: Date; reason: string; created_at: Date }>(
        c,
        "select k.due_on, app.tenant_today($1) as today, k.reason, k.created_at from public.task k where k.created_from_touch_id = $2",
        [t, tc.id],
      );
      expect(ymd(k.due_on)).toBe(ymd(k.today));
      // The reason still names the day it happened.
      const day = await one<{ label: string }>(c, "select to_char(app.tenant_today($1, $2::timestamptz), 'Mon DD') as label", [t, at]);
      expect(k.reason).toContain(day.label);
    });
  });

  it("a recent backfill keeps its rule-based due date when that is still ahead", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd2@test.dev");
      const { contact } = await seed(c, t, rep);
      const at = await daysAgoAt10(c, t, 1);
      const tc = await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail", occurred_at: at });
      const ok = await one<{ ok: boolean }>(
        c,
        "select k.due_on = greatest(app.add_business_days(app.tenant_today($1, $3::timestamptz), 3), app.tenant_today($1)) as ok from public.task k where k.created_from_touch_id = $2",
        [t, tc.id, at],
      );
      expect(ok.ok).toBe(true);
    });
  });

  it("history loaded with created_at = occurred_at behaves as before (due date stays in the past)", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd3@test.dev");
      const { contact } = await seed(c, t, rep);
      const at = await daysAgoAt10(c, t, 10);
      const tc = await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "voicemail", occurred_at: at, created_at: at });
      const k = await one<{ past: boolean }>(c, "select k.due_on < app.tenant_today($1) as past from public.task k where k.created_from_touch_id = $2", [t, tc.id]);
      expect(k.past).toBe(true);
    });
  });

  it("a backdated touch closes tasks that existed then, never a task created after it", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd4@test.dev");
      const { account, contact } = await seed(c, t, rep);
      const older = await one<{ id: string }>(
        c,
        "insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, title, due_on, source, created_at) values ($1,$2,$3,$4,'Older follow-up', current_date, 'rep', now() - interval '6 days') returning id",
        [t, rep, account, contact],
      );
      const newer = await one<{ id: string }>(
        c,
        "insert into public.task(tenant_id, assignee_user_id, account_id, contact_id, title, due_on, source, created_at) values ($1,$2,$3,$4,'Newer follow-up', current_date, 'rep', now() - interval '1 day') returning id",
        [t, rep, account, contact],
      );
      const at = await daysAgoAt10(c, t, 3);
      const tc = await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "site_visit", outcome: "met_in_person", occurred_at: at });
      const o = await one<{ status: string; completed_by_touch_id: string; completed_at: Date }>(c, "select status, completed_by_touch_id, completed_at from public.task where id = $1", [older.id]);
      const n = await one<{ status: string }>(c, "select status from public.task where id = $1", [newer.id]);
      expect(o.status).toBe("done");
      expect(o.completed_by_touch_id).toBe(tc.id);
      expect(o.completed_at.toISOString()).toBe(at);
      expect(n.status).toBe("open");
    });
  });

  it("points are dated when it happened, and the same-day repeat rule uses that day", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd5@test.dev");
      const { contact } = await seed(c, t, rep);
      // Today: a call. Then a backfilled call to the same person 2 days ago → a different day, so it scores.
      await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "connected" });
      const at = await daysAgoAt10(c, t, 2);
      const b1 = await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "connected", occurred_at: at });
      const p1 = await c.query<{ event: string; occurred_at: Date }>("select event, occurred_at from public.point_event where touch_id = $1 order by event", [b1.id]);
      expect(p1.rows.map((r) => r.event)).toEqual(["connect", "touch_logged"]);
      expect(p1.rows.every((r) => r.occurred_at.toISOString() === at)).toBe(true);
      // A second backfilled touch on that same past day: repeat → no touch_logged / connect.
      const later = new Date(Date.parse(at) + 2 * 3600_000).toISOString();
      const b2 = await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "email", outcome: "sent", occurred_at: later });
      const p2 = await c.query("select event from public.point_event where touch_id = $1", [b2.id]);
      expect(p2.rows).toHaveLength(0);
    });
  });

  it("re-closes the backfilled day's rep_day so streaks and the scorecard count it", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd6@test.dev");
      const { contact } = await seed(c, t, rep);
      const at = await daysAgoAt10(c, t, 2);
      const day = await one<{ d: string }>(c, "select app.tenant_today($1, $2::timestamptz)::text as d", [t, at]);
      // That day was closed empty (the nightly job ran before the rep backfilled).
      await c.query("select public.close_rep_day($1, $2::date)", [t, day.d]);
      const before = await one<{ touches: number; cleared: boolean }>(c, "select touches, cleared from public.rep_day where tenant_id=$1 and user_id=$2 and day=$3::date", [t, rep, day.d]);
      expect(before.touches).toBe(0);
      expect(before.cleared).toBe(false);

      await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "site_visit", outcome: "met_in_person", occurred_at: at });
      const after = await one<{ touches: number; in_person: number; points: number; cleared: boolean }>(
        c,
        "select touches, in_person, points, cleared from public.rep_day where tenant_id=$1 and user_id=$2 and day=$3::date",
        [t, rep, day.d],
      );
      expect(after.touches).toBe(1);
      expect(after.in_person).toBe(1);
      expect(after.points).toBeGreaterThan(0);
      expect(after.cleared).toBe(true);
    });
  });

  it("a touch logged now does not create a rep_day for today (the nightly close does)", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "fox");
      const rep = await makeUser(c, t, "bd7@test.dev");
      const { contact } = await seed(c, t, rep);
      await touch(c, { tenant_id: t, user_id: rep, contact_id: contact, channel: "call", outcome: "connected" });
      const r = await c.query("select 1 from public.rep_day where tenant_id=$1 and user_id=$2", [t, rep]);
      expect(r.rows).toHaveLength(0);
    });
  });
});

describe("Condo/HOA management account type", () => {
  it("the domain accepts condo_hoa_mgmt (and still rejects unknown codes)", async () => {
    await inTx(async (c) => {
      const t = await tenantId(c, "tsg");
      const a = await one<{ account_type: string }>(c, "insert into public.account(tenant_id, name, account_type) values ($1,'Harbor Town HOA','condo_hoa_mgmt') returning account_type", [t]);
      expect(a.account_type).toBe("condo_hoa_mgmt");
      // Every pre-existing value is still allowed.
      for (const ty of ["owner", "property_mgmt", "facilities", "asset_mgmt", "reit", "institutional", "gc", "developer", "broker", "consultant", "architect", "government", "education", "healthcare", "industrial", "retail", "hospitality", "religious", "vendor", "other"]) {
        await c.query("insert into public.account(tenant_id, name, account_type) values ($1,$2,$3)", [t, `Type ${ty}`, ty]);
      }
      await c.query("savepoint s");
      await expect(c.query("insert into public.account(tenant_id, name, account_type) values ($1,'Bad','hoa')", [t])).rejects.toThrow(/account_type_check/);
      await c.query("rollback to savepoint s");
    });
  });

  it("has a label sorted right after Property mgmt and default TSG/FOX targeting like PMCs", async () => {
    await inTx(async (c) => {
      const v = await c.query<{ code: string; label: string }>("select code, label from public.vocab where domain='account_type' order by sort, code limit 2");
      expect(v.rows).toEqual([
        { code: "property_mgmt", label: "Property mgmt" },
        { code: "condo_hoa_mgmt", label: "Condo/HOA management" },
      ]);
      const tt = await c.query<{ slug: string; mode: string; weight: string }>(
        "select t.slug, tt.mode, tt.weight::text from public.tenant_targeting tt join public.tenant t on t.id = tt.tenant_id where tt.dimension='account_type' and tt.value='condo_hoa_mgmt' order by t.slug",
      );
      expect(tt.rows).toEqual([
        { slug: "fox", mode: "include", weight: "1.20" },
        { slug: "tsg", mode: "include", weight: "1.20" },
      ]);
    });
  });
});
