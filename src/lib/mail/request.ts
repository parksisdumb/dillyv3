import "server-only";
import { after } from "next/server";
import { inngest } from "@/inngest/client";
import { mailSyncRequested } from "@/inngest/functions/mail-sync";
import { log } from "@/lib/observability/log";

/**
 * Ask for a sync of one connection. Normally an Inngest event; if Inngest can't take it (not configured, outage)
 * a smaller sync runs right after the response is sent, so "Connect" and "Sync now" still do something.
 */
export async function requestMailSync(connectionId: string, tenantId: string, reason: "connected" | "manual"): Promise<"queued" | "inline"> {
  try {
    await inngest.send(mailSyncRequested.create({ connectionId, tenantId }, { id: `mail-sync-${reason}-${connectionId}-${Math.floor(Date.now() / 30_000)}` }));
    return "queued";
  } catch (err) {
    log.warn("mail:sync-request-inline", { tenant: tenantId, connection: connectionId, reason, err });
    after(async () => {
      try {
        const { runMailSync } = await import("./server");
        await runMailSync(connectionId, { cap: 200 });
      } catch (e) {
        log.error("mail:sync-inline-failed", { tenant: tenantId, connection: connectionId, err: e });
      }
    });
    return "inline";
  }
}
