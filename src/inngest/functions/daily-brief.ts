import { cron } from "inngest";
import { adminDb } from "@/agents/runtime/db";
import { activeReps } from "@/agents/rep-daily-brief/data";
import { runRepDailyBrief } from "@/agents/rep-daily-brief/agent";
import { inngest, repDailyBriefRequested } from "../client";
import { isBriefWindow, loadAllTenants, tenantsWhere } from "../tenants";

/**
 * Every 15 min: tenants whose local time is 06:00–06:14 (weekday, or weekend if enabled)
 * get one `dilly/rep-daily-brief.requested` event per active rep. Event ids dedupe re-fires.
 */
export const dailyBriefFanout = inngest.createFunction(
  { id: "daily-brief-fanout", name: "Rep Daily Brief — 06:00 fan-out", triggers: [cron("*/15 * * * *")] },
  async ({ step }) => {
    const targets = await step.run("find-tenants-at-0600", async () => {
      const db = await adminDb();
      const due = tenantsWhere(await loadAllTenants(db), new Date(), isBriefWindow);
      return Promise.all(
        due.map(async ({ tenant, clock }) => ({
          tenantId: tenant.id,
          forDate: clock.date,
          userIds: await activeReps(db, tenant.id, tenant.briefRoles),
        })),
      );
    });

    const events = targets.flatMap((t) =>
      t.userIds.map((userId) =>
        repDailyBriefRequested.create(
          { tenantId: t.tenantId, userId, forDate: t.forDate, trigger: "cron" },
          { id: `brief-${t.tenantId}-${userId}-${t.forDate}` },
        ),
      ),
    );
    if (events.length) await step.sendEvent("emit-brief-requests", events);
    return { tenants: targets.length, briefs: events.length };
  },
);

/** One brief for one rep. Concurrency is limited per tenant; failed runs are logged then retried (2×). */
export const dailyBriefRun = inngest.createFunction(
  {
    id: "daily-brief-run",
    name: "Rep Daily Brief — run",
    triggers: [repDailyBriefRequested],
    concurrency: { limit: 3, key: "event.data.tenantId" },
    retries: 2,
  },
  async ({ event, step }) => {
    return step.run("run-rep-daily-brief", async () => {
      const db = await adminDb();
      const res = await runRepDailyBrief(
        {
          tenantId: event.data.tenantId,
          userId: event.data.userId,
          forDate: event.data.forDate,
          trigger: event.data.trigger ?? "event",
        },
        { db },
      );
      return {
        runId: res.runId,
        forDate: res.forDate,
        source: res.brief.source,
        headline: res.brief.headline,
        grade: res.grade?.score ?? null,
        fallbackReason: res.fallbackReason,
      };
    });
  },
);
