/**
 * Web Push delivery for reminder decisions (implements PushSender from src/agents/rep-daily-brief/reminders.ts).
 *
 * Sends one payload to every active subscription (device) of the rep:
 *   - success        → last_success_at = now, failure_count = 0
 *   - 404 / 410      → the browser dropped the subscription: disabled_at = now (never retried)
 *   - anything else  → failure_count + 1 (retried next push; the rep can re-enable from Settings)
 * Never throws for a delivery problem: reminders keep their insight rows either way.
 * Idempotency: the payload's `tag` is the push key, so a re-sent reminder replaces itself on the device.
 */
import type { Db } from "@/agents/runtime/db";
import type { PushDecision } from "@/agents/rep-daily-brief/rank";
import { log } from "@/lib/observability/log";
import { vapidConfig, type VapidConfig } from "./config";
import { notificationFor, type PushPayload } from "./copy";

/** The slice of the `web-push` module we use (lets tests pass a fake). */
export interface WebPushClient {
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL: number; urgency?: "very-low" | "low" | "normal" | "high" },
  ): Promise<{ statusCode: number }>;
}

export type DeliveryResult = {
  delivered: boolean;
  channel: "webpush";
  devices: number;
  sent: number;
  failed: number;
  disabled: number;
};

export type PushSendArgs = { tenantId: string; userId: string; push: PushDecision; notification?: PushPayload };

/** Reminders are about today: a phone that's off for 4 h doesn't need them afterwards. */
const TTL_SECONDS = 4 * 3600;

function statusOf(err: unknown): number | null {
  const s = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof s === "number" ? s : null;
}

export function createWebPushSender(opts: { db: Db; vapid: VapidConfig; client: WebPushClient; now?: () => Date }) {
  const { db, vapid, client } = opts;
  const now = opts.now ?? (() => new Date());

  async function deliver(tenantId: string, userId: string, payload: PushPayload): Promise<DeliveryResult> {
    const { data, error } = await db
      .from("push_subscription")
      .select("id,endpoint,p256dh,auth,failure_count")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .is("disabled_at", null);
    if (error) throw new Error(`load push subscriptions: ${error.message}`);
    const subs = data ?? [];
    const result: DeliveryResult = { delivered: false, channel: "webpush", devices: subs.length, sent: 0, failed: 0, disabled: 0 };
    const body = JSON.stringify(payload);

    await Promise.all(
      subs.map(async (s) => {
        let patch: { last_success_at?: string; failure_count?: number; disabled_at?: string };
        try {
          await client.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
            TTL: TTL_SECONDS,
            urgency: "normal",
          });
          result.sent++;
          patch = { last_success_at: now().toISOString(), failure_count: 0 };
        } catch (err) {
          const status = statusOf(err);
          if (status === 404 || status === 410) {
            result.disabled++;
            patch = { disabled_at: now().toISOString() };
            log.info("push:subscription-gone", { tenant: tenantId, user: userId, subscription: s.id, status });
          } else {
            result.failed++;
            patch = { failure_count: (s.failure_count ?? 0) + 1 };
            log.warn("push:send-failed", { tenant: tenantId, user: userId, subscription: s.id, status, err });
          }
        }
        const upd = await db.from("push_subscription").update(patch).eq("id", s.id);
        if (upd.error) log.warn("push:subscription-update-failed", { subscription: s.id, err: upd.error });
      }),
    );
    result.delivered = result.sent > 0;
    return result;
  }

  return {
    deliver,
    async send({ tenantId, userId, push, notification }: PushSendArgs): Promise<DeliveryResult> {
      return deliver(tenantId, userId, notification ?? notificationFor(push));
    },
  };
}

export type WebPushSender = ReturnType<typeof createWebPushSender>;

/** The real `web-push` module, loaded only when VAPID keys are configured. */
export async function loadWebPushClient(): Promise<WebPushClient> {
  const mod = await import("web-push");
  return (mod.default ?? mod) as unknown as WebPushClient;
}

/** Web Push sender when VAPID env is set; null otherwise (callers fall back to record-only). */
export async function defaultPushSender(db: Db, env: Record<string, string | undefined> = process.env): Promise<WebPushSender | null> {
  const vapid = vapidConfig(env);
  if (!vapid) return null;
  return createWebPushSender({ db, vapid, client: await loadWebPushClient() });
}
