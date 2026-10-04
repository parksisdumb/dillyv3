import { cron, eventType } from "inngest";
import { z } from "zod";
import { log } from "@/lib/observability/log";
import { isGoogleMailConfigured } from "@/lib/mail/config";
import { inngest } from "../client";

/**
 * Sync one mailbox connection now. Sent by the 10-minute cron, the OAuth callback (initial 30-day sync) and
 * Settings → "Sync now":
 *   { name: "dilly/mail.sync.requested", data: { connectionId, tenantId? } }
 */
export const mailSyncRequested = eventType("dilly/mail.sync.requested", {
  schema: z.object({ connectionId: z.string().uuid(), tenantId: z.string().uuid().optional() }),
});

/** Every 10 min: one sync event per active connection. Event ids dedupe double fires within a tick. */
export const mailSyncFanout = inngest.createFunction(
  {
    id: "mail-sync-fanout",
    name: "Mail sync — 10-minute fan-out",
    triggers: [cron("*/10 * * * *")],
    retries: 2,
    singleton: { mode: "skip" },
  },
  async ({ step }) => {
    if (!isGoogleMailConfigured()) return { skipped: "not_configured", connections: 0 };
    const { conns, tick } = await step.run("list-active-connections", async () => {
      const { activeConnections } = await import("@/lib/mail/server");
      return { conns: await activeConnections(), tick: Math.floor(Date.now() / 600_000) };
    });
    const events = conns.map((c) =>
      mailSyncRequested.create({ connectionId: c.id, tenantId: c.tenant_id }, { id: `mail-sync-${c.id}-${tick}` }),
    );
    if (events.length) await step.sendEvent("emit-mail-syncs", events);
    return { connections: events.length };
  },
);

/**
 * One connection's sync. Never two at once for the same mailbox; at most 3 per tenant so one big tenant can't
 * starve the others. Mailbox problems (revoked grant, rate limit) are handled inside and don't fail the run;
 * an unexpected failure is logged with the tenant and retried by Inngest (the sync is idempotent).
 */
export const mailSyncRun = inngest.createFunction(
  {
    id: "mail-sync-run",
    name: "Mail sync — run",
    triggers: [mailSyncRequested],
    concurrency: [
      { limit: 1, key: "event.data.connectionId" },
      { limit: 3, key: "event.data.tenantId" },
    ],
    retries: 2,
  },
  async ({ event, step }) => {
    return step.run("sync-connection", async () => {
      const started = Date.now();
      try {
        const { runMailSync } = await import("@/lib/mail/server");
        const res = await runMailSync(event.data.connectionId);
        if (!res) return { skipped: true };
        if (!res.ok && !res.revoked) throw new Error(res.error);
        return { ok: res.ok, revoked: !res.ok && res.revoked, ...res.stats };
      } catch (err) {
        log.error("inngest:mail-sync-run:failed", {
          tenant: event.data.tenantId ?? null,
          connection: event.data.connectionId,
          durationMs: Date.now() - started,
          err,
        });
        throw err;
      }
    });
  },
);
