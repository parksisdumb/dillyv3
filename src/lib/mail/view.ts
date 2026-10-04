import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Ctx } from "@/lib/server/ctx";
import { safeData } from "@/lib/server/safe";
import { isGoogleMailConfigured } from "./config";
import type { MailProviderId } from "./provider";

/** Non-secret view of the signed-in user's connection (public.my_mail_connection — RLS + column grants). */
export type MyMailConnection = {
  id: string;
  tenant_id: string;
  provider: MailProviderId;
  email: string;
  status: "active" | "revoked" | "error";
  last_synced_at: string | null;
  last_error: string | null;
};

export async function loadMyMailConnection(c: Ctx): Promise<{ configured: boolean; conn: MyMailConnection | null }> {
  const configured = isGoogleMailConfigured();
  if (!configured) return { configured, conn: null };
  const sb = c.sb as unknown as SupabaseClient;
  const conn = await safeData(
    sb.from("my_mail_connection").select("id,tenant_id,provider,email,status,last_synced_at,last_error").eq("tenant_id", c.tenantId).eq("provider", "google").maybeSingle(),
    null,
    "mail:my-connection",
    { tenant: c.tenantId, user: c.s.userId },
  );
  return { configured, conn: (conn as MyMailConnection | null) ?? null };
}
