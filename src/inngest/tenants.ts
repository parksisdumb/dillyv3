import { log } from "@/lib/observability/log";
import { localClock, type LocalClock } from "@/agents/runtime/clock";
import { must, type Db } from "@/agents/runtime/db";
import { briefRolesFrom, type TenantInfo } from "@/agents/rep-daily-brief/data";
import { settingsFromTenant } from "@/agents/rep-daily-brief/rank";

export async function loadAllTenants(db: Db): Promise<TenantInfo[]> {
  const rows = must(await db.from("tenant").select("id, name, timezone, settings"), "load tenants") ?? [];
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    timezone: t.timezone,
    settings: settingsFromTenant(t.timezone, t.settings),
    briefRoles: briefRolesFrom(t.settings),
  }));
}

/** Tenants whose local clock satisfies `pred` right now. */
export function tenantsWhere(tenants: TenantInfo[], now: Date, pred: (c: LocalClock, t: TenantInfo) => boolean) {
  return tenants.flatMap((t) => {
    const c = localClock(t.timezone, now);
    return pred(c, t) ? [{ tenant: t, clock: c }] : [];
  });
}

/** 06:00–06:14 local on a weekday (or weekend when tenant.settings.weekend_reminders). */
export function isBriefWindow(c: LocalClock, t: TenantInfo): boolean {
  if (c.isoDow >= 6 && !t.settings.weekendReminders) return false;
  return c.hour === 6 && c.minute < 15;
}

export type TenantOutcome<T> = { tenantId: string; ok: true; value: T } | { tenantId: string; ok: false; error: string };

/**
 * Run one tenant's slice of a cron and never let it stop the loop. Wrap `step.run(...)` in this: the step
 * keeps its own retries (a failed step is retried by Inngest before it throws here), and only after those
 * are exhausted do we log, record the failure and move on to the next tenant.
 */
export async function perTenant<T>(fn: string, tenantId: string, work: () => Promise<T>): Promise<TenantOutcome<T>> {
  const started = Date.now();
  try {
    return { tenantId, ok: true, value: await work() };
  } catch (err) {
    log.error(`inngest:${fn}:tenant-failed`, { tenant: tenantId, durationMs: Date.now() - started, err });
    return { tenantId, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
