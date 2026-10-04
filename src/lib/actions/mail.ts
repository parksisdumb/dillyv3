"use server";
import { revalidatePath } from "next/cache";
import { ctx } from "@/lib/server/ctx";
import type { ActionState } from "@/lib/actions/state";
import { log } from "@/lib/observability/log";
import { isGoogleMailConfigured } from "@/lib/mail/config";
import { disconnectConnection, myConnectionId } from "@/lib/mail/server";
import { requestMailSync } from "@/lib/mail/request";

// Both actions act on the signed-in user's own connection in the active tenant — never an id from the form.

export async function syncMailNow(_: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  const { s, tenantId } = await ctx();
  if (!isGoogleMailConfigured()) return { ok: false, error: "Email sync isn't configured yet." };
  try {
    const id = await myConnectionId(tenantId, s.userId);
    if (!id) return { ok: false, error: "Connect Gmail first." };
    await requestMailSync(id, tenantId, "manual");
    revalidatePath("/app/settings");
    return { ok: true, message: "Syncing — new emails show up in a minute" };
  } catch (err) {
    log.error("action:syncMailNow", { tenant: tenantId, user: s.userId, err });
    return { ok: false, error: "Couldn't start a sync. Try again in a minute." };
  }
}

export async function disconnectMail(_: ActionState, _fd: FormData): Promise<ActionState> {
  void _fd;
  const { s, tenantId } = await ctx();
  try {
    const id = await myConnectionId(tenantId, s.userId);
    if (id) await disconnectConnection(id);
    log.info("mail:disconnected", { tenant: tenantId, user: s.userId, connection: id });
    revalidatePath("/app", "layout");
    return { ok: true, message: "Gmail disconnected. Emails already logged stay on the timeline." };
  } catch (err) {
    log.error("action:disconnectMail", { tenant: tenantId, user: s.userId, err });
    return { ok: false, error: "Couldn't disconnect. Try again." };
  }
}
