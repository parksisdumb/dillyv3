import { cron } from "inngest";
import { adminDb } from "@/agents/runtime/db";
import { closeDay } from "@/agents/rep-daily-brief/close-day";
import { inngest } from "../client";
import { loadAllTenants, tenantsWhere } from "../tenants";

/** Hourly: tenants at 23:00–23:59 local close the day; Friday close awards clean_week. */
export const closeRepDay = inngest.createFunction(
  { id: "close-rep-day", name: "Close rep day (23:00 local)", triggers: [cron("5 * * * *")], retries: 2 },
  async ({ step }) => {
    const due = await step.run("find-tenants-at-2300", async () => {
      const db = await adminDb();
      return tenantsWhere(await loadAllTenants(db), new Date(), (c) => c.hour === 23).map(({ tenant, clock }) => ({
        tenantId: tenant.id,
        day: clock.date,
      }));
    });
    const results = [];
    for (const t of due) {
      results.push(await step.run(`close-${t.tenantId}-${t.day}`, async () => closeDay(await adminDb(), t.tenantId, t.day)));
    }
    return { tenants: due.length, results };
  },
);
