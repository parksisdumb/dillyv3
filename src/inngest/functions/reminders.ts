import { cron } from "inngest";
import { adminDb } from "@/agents/runtime/db";
import { activeReps } from "@/agents/rep-daily-brief/data";
import { inPushWindow, runEscalationsForTenant, runRemindersForRep } from "@/agents/rep-daily-brief/reminders";
import { log } from "@/lib/observability/log";
import { inngest } from "../client";
import { loadAllTenants, perTenant, tenantsWhere } from "../tenants";

/**
 * Every 15 min (appointment reminders land within 15 min of `reminder_minutes`): for tenants inside their push window (07:00–19:00 local, weekdays unless enabled),
 * apply the reminder ladder per rep and record the pushes due now as `insight` rows (kind 'reminder').
 * Delivery: Web Push to the rep's devices when VAPID env is set (src/lib/push/sender.ts), else record-only.
 *
 * Idempotent: pushes already decided today are read back from prior runs (pushKeysSentToday), so a
 * double fire records nothing new. One rep's or one tenant's failure never stops the rest.
 */
export const reminders = inngest.createFunction(
  {
    id: "reminders",
    name: "Rep reminders (push ladder)",
    triggers: [cron("*/15 * * * *")],
    retries: 1,
    singleton: { mode: "skip" },
  },
  async ({ step }) => {
    // Fix "now" inside a step so replays see the same clock.
    const { at, due } = await step.run("find-tenants-in-window", async () => {
      const db = await adminDb();
      const now = new Date();
      const open = tenantsWhere(await loadAllTenants(db), now, (_c, t) => inPushWindow(t.settings, now));
      const settled = await Promise.allSettled(
        open.map(async ({ tenant }) => ({ tenant, userIds: await activeReps(db, tenant.id, tenant.briefRoles) })),
      );
      const due = settled.flatMap((r, i) => {
        if (r.status === "fulfilled") return [r.value];
        log.error("inngest:reminders:tenant-failed", { tenant: open[i].tenant.id, err: r.reason });
        return [];
      });
      return { at: now.toISOString(), due };
    });
    const now = new Date(at);
    let pushes = 0;
    let failedTenants = 0;
    for (const { tenant, userIds } of due) {
      const r = await perTenant("reminders", tenant.id, () =>
        step.run(`reminders-${tenant.id}`, async () => {
          const db = await adminDb();
          let n = 0;
          for (const userId of userIds) {
            try {
              n += (await runRemindersForRep({ tenant, userId, now }, { db })).pushes.length;
            } catch (err) {
              // One rep's failure must not block the rest; the failed run (if created) is logged by runAgent.
              log.error("inngest:reminders:rep-failed", { tenant: tenant.id, user: userId, err });
            }
          }
          return n;
        }),
      );
      if (r.ok) pushes += r.value;
      else failedTenants++;
    }
    return { tenants: due.length, failedTenants, pushes };
  },
);

/**
 * Hourly, acting at 08:00 tenant-local on weekdays: manager cards for P1/P2 tasks overdue > 3 business days.
 * Idempotent: a card is only created when no open escalation with the same title exists.
 */
export const managerEscalations = inngest.createFunction(
  {
    id: "manager-escalations",
    name: "Manager escalations (08:00 local)",
    triggers: [cron("0 * * * *")],
    retries: 2,
    singleton: { mode: "skip" },
  },
  async ({ step }) => {
    const { at, due } = await step.run("find-tenants-at-0800", async () => {
      const db = await adminDb();
      const now = new Date();
      const at8 = tenantsWhere(await loadAllTenants(db), now, (c) => c.hour === 8 && c.isoDow <= 5);
      const settled = await Promise.allSettled(
        at8.map(async ({ tenant }) => ({ tenant, userIds: await activeReps(db, tenant.id, tenant.briefRoles) })),
      );
      const due = settled.flatMap((r, i) => {
        if (r.status === "fulfilled") return [r.value];
        log.error("inngest:manager-escalations:tenant-failed", { tenant: at8[i].tenant.id, err: r.reason });
        return [];
      });
      return { at: now.toISOString(), due };
    });
    const now = new Date(at);
    let created = 0;
    let failedTenants = 0;
    for (const { tenant, userIds } of due) {
      const r = await perTenant("manager-escalations", tenant.id, () =>
        step.run(`escalate-${tenant.id}`, async () => {
          const res = await runEscalationsForTenant({ tenant, userIds, now }, { db: await adminDb() });
          return res.created;
        }),
      );
      if (r.ok) created += r.value;
      else failedTenants++;
    }
    return { tenants: due.length, failedTenants, created };
  },
);
