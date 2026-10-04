"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import type { ActionState } from "@/lib/actions/state";
import type { Db } from "@/agents/runtime/db";
import { log } from "@/lib/observability/log";
import { vapidConfig } from "./config";
import { createWebPushSender, loadWebPushClient } from "./sender";

const subscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://").max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/** Save this browser's push subscription for me (re-subscribing the same browser updates the row). */
export async function savePushSubscription(sub: unknown, userAgent?: string): Promise<ActionState> {
  const parsed = subscriptionSchema.safeParse(sub);
  if (!parsed.success) return { ok: false, error: "This browser returned an unusable push subscription. Try again." };
  const { sb, tenantId } = await ctx();
  const { error } = await sb.rpc("save_push_subscription", {
    p_tenant: tenantId,
    p_endpoint: parsed.data.endpoint,
    p_p256dh: parsed.data.keys.p256dh,
    p_auth: parsed.data.keys.auth,
    p_user_agent: userAgent?.slice(0, 300) ?? undefined,
  });
  if (error) return { ok: false, error: dbMessage(error, "turn on reminders for this phone") };
  revalidatePath("/app/settings");
  return { ok: true, message: "Reminders on for this phone" };
}

/** Turn off this browser (by its endpoint). Missing rows are fine. */
export async function removePushSubscriptionByEndpoint(endpoint: string): Promise<ActionState> {
  if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) return { ok: false, error: "Unknown device." };
  const { sb, s } = await ctx();
  const { error } = await sb.from("push_subscription").delete().eq("user_id", s.userId).eq("endpoint", endpoint);
  if (error) return { ok: false, error: dbMessage(error, "turn off reminders for this phone") };
  revalidatePath("/app/settings");
  return { ok: true, message: "Reminders off for this phone" };
}

const idSchema = z.object({ id: z.string().uuid() });

/** Remove one of my devices from the Settings list. */
export async function removePushDevice(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = idSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, s } = await ctx();
  const { error } = await sb.from("push_subscription").delete().eq("id", parsed.data.id).eq("user_id", s.userId);
  if (error) return { ok: false, error: dbMessage(error, "remove that device") };
  revalidatePath("/app/settings");
  return { ok: true, message: "Device removed" };
}

/** Send a test notification to all my active devices. */
export async function sendTestPush(_: ActionState, _fd?: FormData): Promise<ActionState> {
  void _fd;
  const vapid = vapidConfig();
  if (!vapid) return { ok: false, error: "Push isn't set up on the server yet (VAPID keys missing). Tell your admin." };
  const { sb, s, tenantId } = await ctx();
  try {
    // The rep's own client: RLS limits this to their rows, and lets the sender mark dead devices.
    const sender = createWebPushSender({ db: sb as unknown as Db, vapid, client: await loadWebPushClient() });
    const r = await sender.deliver(tenantId, s.userId, {
      title: "Dilly reminders are on",
      body: "This is what a reminder looks like. Tap to open Today.",
      url: "/app/today",
      tag: "dilly:test",
    });
    revalidatePath("/app/settings");
    if (r.devices === 0) return { ok: false, error: "No devices yet — turn on reminders on this phone first." };
    if (r.sent === 0) {
      return {
        ok: false,
        error: r.disabled ? "That device stopped accepting notifications. Turn reminders on again on the phone." : "Couldn't reach your devices. Try again in a minute.",
      };
    }
    const n = r.sent === 1 ? "1 device" : `${r.sent} devices`;
    return { ok: true, message: `Test sent to ${n}${r.failed + r.disabled ? ` (${r.failed + r.disabled} didn't answer)` : ""}` };
  } catch (err) {
    log.error("push:test-failed", { tenant: tenantId, user: s.userId, err });
    return { ok: false, error: "Couldn't send the test. Try again in a minute." };
  }
}
