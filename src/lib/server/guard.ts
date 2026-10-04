import "server-only";
import { notFound, redirect } from "next/navigation";
import { ctx } from "@/lib/server/ctx";
import type { Session } from "@/lib/session";

/** Team screens are for owner/admin/manager; reps land on their own stats instead. */
export function requireManager(s: Session) {
  if (!s.isManager) redirect("/app/me");
}

type RecordTable = "account" | "contact" | "property" | "opportunity";

/**
 * Record routes call this from `[id]/layout.tsx` — OUTSIDE any loading.tsx Suspense boundary — so a bad id, a merged
 * duplicate or another company's record answers with a real HTTP 404. Inside a streamed page the status line has
 * already gone out as 200 by the time `notFound()` runs.
 */
export async function requireRecord(table: RecordTable, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { sb, tenantId } = await ctx();
  let q = sb.from(table).select("id").eq("tenant_id", tenantId).eq("id", id);
  if (table !== "opportunity") q = q.is("duplicate_of", null);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`requireRecord(${table}): ${error.message}`);
  if (!data) notFound();
}
