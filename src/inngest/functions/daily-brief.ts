import { cron } from "inngest";
import { adminDb } from "@/agents/runtime/db";
import { activeReps } from "@/agents/rep-daily-brief/data";
import { runRepDailyBrief } from "@/agents/rep-daily-brief/agent";
import { log } from "@/lib/observability/log";
import { inngest, repDailyBriefRequested } from "../client";
import { isBriefWindow, loadAllTenants, tenantsWhere } from "../tenants";

/**
 * Every 15 min: tenants whose local time is 06:00–06:14 (weekday, or weekend if enabled)
 * get one `dilly/rep-daily-brief.requested` event per active rep. Event ids dedupe re-fires, so a double
 * run (or a retry) never produces a second brief. One tenant's failure to list reps doesn't stop the others.
 */
export const dailyBriefFanout = inngest.createFunction(
  {
    id: "daily-brief-fanout",
    name: "Rep Daily Brief — 06:00 fan-out",
    triggers: [cron("*/15 * * * *")],
    retries: 2,
    singleton: { mode: "skip" },
  },
  async ({ step }) => {
    const { targets, failed } = await step.run("find-tenants-at-0600", async () => {
      const db = await adminDb();
      const due = tenantsWhere(await loadAllTenants(db), new Date(), isBriefWindow);
      const settled = await Promise.allSettled(
        due.map(async ({ tenant, clock }) => ({
          tenantId: tenant.id,
          forDate: clock.date,
          userIds: await activeReps(db, tenant.id, tenant.briefRoles),
        })),
      );
      const failed: string[] = [];
      const targets = settled.flatMap((r, i) => {
        if (r.status === "fulfilled") return [r.value];
        failed.push(due[i].tenant.id);
        log.error("inngest:daily-brief-fanout:tenant-failed", { tenant: due[i].tenant.id, err: r.reason });
        return [];
      });
      // If every tenant failed it's likely the DB: throw so the step retries.
      if (due.length > 0 && targets.length === 0) throw new Error(`could not list reps for any of ${due.length} tenants`);
      return { targets, failed };
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
    return { tenants: targets.length, failedTenants: failed, briefs: events.length };
  },
);

/**
 * One brief for one rep. Concurrency is limited per tenant (3) so one big tenant can't starve the others;
 * failed runs are logged then retried (2×). An Anthropic outage never fails a brief: the agent falls back to
 * the deterministic template (LLM calls time out at 30 s).
 */
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
      const started = Date.now();
      try {
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
        log.info("inngest:daily-brief-run", {
          tenant: event.data.tenantId,
          user: event.data.userId,
          source: res.brief.source,
          fallbackReason: res.fallbackReason,
          durationMs: Date.now() - started,
        });
        return {
          runId: res.runId,
          forDate: res.forDate,
          source: res.brief.source,
          headline: res.brief.headline,
          grade: res.grade?.score ?? null,
          fallbackReason: res.fallbackReason,
        };
      } catch (err) {
        log.error("inngest:daily-brief-run:failed", { tenant: event.data.tenantId, user: event.data.userId, durationMs: Date.now() - started, err });
        throw err; // Inngest retries; each attempt is its own logged agent_run
      }
    });
  },
);
