import { cron } from "inngest";
import { adminDb } from "@/agents/runtime/db";
import { closeDay } from "@/agents/rep-daily-brief/close-day";
import { log } from "@/lib/observability/log";
import { inngest } from "../client";
import { loadAllTenants, perTenant, tenantsWhere } from "../tenants";

/**
 * Hourly: tenants at 23:00–23:59 local close the day; Friday close awards clean_week.
 * Idempotent: close_rep_day is an upsert and clean_week skips reps already awarded, so a double fire is harmless.
 * singleton/skip: an overlapping run (slow DB) is skipped rather than racing the first.
 */
export const closeRepDay = inngest.createFunction(
  {
    id: "close-rep-day",
    name: "Close rep day (23:00 local)",
    triggers: [cron("5 * * * *")],
    retries: 2,
    singleton: { mode: "skip" },
  },
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
      results.push(await perTenant("close-rep-day", t.tenantId, () => step.run(`close-${t.tenantId}-${t.day}`, async () => closeDay(await adminDb(), t.tenantId, t.day))));
    }
    const failed = results.filter((r) => !r.ok).length;
    log.info("inngest:close-rep-day", { tenants: due.length, failed });
    return { tenants: due.length, failed, results };
  },
);
