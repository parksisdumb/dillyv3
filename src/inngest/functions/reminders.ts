import { cron } from "inngest";
import { adminDb } from "@/agents/runtime/db";
import { activeReps } from "@/agents/rep-daily-brief/data";
import { inPushWindow, runEscalationsForTenant, runRemindersForRep } from "@/agents/rep-daily-brief/reminders";
import { inngest } from "../client";
import { loadAllTenants, tenantsWhere } from "../tenants";

/**
 * Every 30 min: for tenants inside their push window (07:00–19:00 local, weekdays unless enabled),
 * apply the reminder ladder per rep and record the pushes due now as `insight` rows (kind 'reminder').
 * Delivery: TODO(web-push) — see PushSender in src/agents/rep-daily-brief/reminders.ts.
 */
export const reminders = inngest.createFunction(
  { id: "reminders", name: "Rep reminders (push ladder)", triggers: [cron("*/30 * * * *")], retries: 1 },
  async ({ step }) => {
    // Fix "now" inside a step so replays see the same clock.
    const { at, due } = await step.run("find-tenants-in-window", async () => {
      const db = await adminDb();
      const now = new Date();
      const open = tenantsWhere(await loadAllTenants(db), now, (_c, t) => inPushWindow(t.settings, now));
      const due = await Promise.all(
        open.map(async ({ tenant }) => ({ tenant, userIds: await activeReps(db, tenant.id, tenant.briefRoles) })),
      );
      return { at: now.toISOString(), due };
    });
    const now = new Date(at);
    let pushes = 0;
    for (const { tenant, userIds } of due) {
      pushes += await step.run(`reminders-${tenant.id}`, async () => {
        const db = await adminDb();
        let n = 0;
        for (const userId of userIds) {
          try {
            n += (await runRemindersForRep({ tenant, userId, now }, { db })).pushes.length;
          } catch (e) {
            // One rep's failure must not block the rest; the failed run (if created) is logged by runAgent.
            console.error(`[reminders] tenant ${tenant.id} rep ${userId}:`, e);
          }
        }
        return n;
      });
    }
    return { tenants: due.length, pushes };
  },
);

/** Hourly, acting at 08:00 tenant-local on weekdays: manager cards for P1/P2 tasks overdue > 3 business days. */
export const managerEscalations = inngest.createFunction(
  { id: "manager-escalations", name: "Manager escalations (08:00 local)", triggers: [cron("0 * * * *")], retries: 2 },
  async ({ step }) => {
    const { at, due } = await step.run("find-tenants-at-0800", async () => {
      const db = await adminDb();
      const now = new Date();
      const at8 = tenantsWhere(await loadAllTenants(db), now, (c) => c.hour === 8 && c.isoDow <= 5);
      const due = await Promise.all(
        at8.map(async ({ tenant }) => ({ tenant, userIds: await activeReps(db, tenant.id, tenant.briefRoles) })),
      );
      return { at: now.toISOString(), due };
    });
    const now = new Date(at);
    let created = 0;
    for (const { tenant, userIds } of due) {
      created += await step.run(`escalate-${tenant.id}`, async () => {
        const res = await runEscalationsForTenant({ tenant, userIds, now }, { db: await adminDb() });
        return res.created;
      });
    }
    return { tenants: due.length, created };
  },
);
