/**
 * End of day: snapshot rep_day via close_rep_day(), and on Friday award `clean_week`
 * when all five weekdays were cleared.
 */
import { addDays, isoDow, weekStart } from "../runtime/clock";
import { must, type Db } from "../runtime/db";

export const CLEAN_WEEK_EVENT = "clean_week";

/** Pure: did this rep clear Mon–Fri of the week containing `friday`? */
export function isCleanWeek(days: { day: string; cleared: boolean }[], friday: string): boolean {
  const mon = weekStart(friday);
  const needed = [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
  const cleared = new Set(days.filter((d) => d.cleared).map((d) => d.day));
  return needed.every((d) => cleared.has(d));
}

/** Tenant override wins over the platform default (tenant_id null). 0 = not configured. */
export async function pointsFor(db: Db, tenantId: string, event: string): Promise<number> {
  const rows = must(
    await db.from("point_rule").select("tenant_id, points").eq("event", event).or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
    "load point_rule",
  );
  const own = (rows ?? []).find((r) => r.tenant_id === tenantId);
  return own?.points ?? (rows ?? []).find((r) => r.tenant_id === null)?.points ?? 0;
}

export interface CloseDayResult {
  day: string;
  closed: number;
  cleanWeekAwarded: string[];
}

export async function closeDay(db: Db, tenantId: string, day: string): Promise<CloseDayResult> {
  const closed = must(await db.rpc("close_rep_day", { p_tenant: tenantId, p_day: day }), "close_rep_day");
  const awarded: string[] = [];
  if (isoDow(day) === 5) {
    const points = await pointsFor(db, tenantId, CLEAN_WEEK_EVENT);
    if (points > 0) {
      const mon = weekStart(day);
      const rows = must(
        await db
          .from("rep_day")
          .select("user_id, day, cleared")
          .eq("tenant_id", tenantId)
          .gte("day", mon)
          .lte("day", day),
        "load week rep_day",
      );
      const byUser = new Map<string, { day: string; cleared: boolean }[]>();
      for (const r of rows ?? []) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r]);
      const winners = [...byUser.entries()].filter(([, d]) => isCleanWeek(d, day)).map(([u]) => u);
      if (winners.length) {
        // Idempotent: skip reps already awarded this week (the hourly cron can re-run within the hour).
        const already = must(
          await db
            .from("point_event")
            .select("user_id")
            .eq("tenant_id", tenantId)
            .eq("event", CLEAN_WEEK_EVENT)
            .in("user_id", winners)
            .gte("occurred_at", `${mon}T00:00:00Z`),
          "load clean_week events",
        );
        const done = new Set((already ?? []).map((a) => a.user_id));
        const fresh = winners.filter((u) => !done.has(u));
        if (fresh.length) {
          must(
            await db.from("point_event").insert(fresh.map((u) => ({ tenant_id: tenantId, user_id: u, event: CLEAN_WEEK_EVENT, points }))),
            "insert clean_week",
          );
          // Re-close so Friday's rep_day.points includes the award (close_rep_day is an idempotent upsert).
          must(await db.rpc("close_rep_day", { p_tenant: tenantId, p_day: day }), "close_rep_day (recount)");
          awarded.push(...fresh);
        }
      }
    }
  }
  return { day, closed: Number(closed), cleanWeekAwarded: awarded };
}
