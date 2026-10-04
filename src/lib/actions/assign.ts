"use server";
// Bulk assign / reassign, tier and preference for managers. One RPC (bulk_update_accounts) = one transaction.
// Tasks follow the account owner: see 20261004200000_import_assign_scorecard.sql.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { PREFERENCES } from "@/lib/domain/vocab";
import type { Json } from "@/lib/db/database.types";

export type BulkResult = { ok: true; message: string; accounts: number; tasksMoved: number } | { ok: false; error: string };

const schema = z.object({
  accountIds: z.array(z.string().uuid()).min(1, "Pick at least one account").max(1000),
  ownerUserId: z.string().uuid().nullable().optional(),
  tier: z.number().int().min(1).max(4).optional(),
  preference: z.enum([...(Object.keys(PREFERENCES) as [string, ...string[]]), "none"]).optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function bulkUpdateAccounts(input: z.input<typeof schema>): Promise<BulkResult> {
  const v = schema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Check the selection." };
  const { sb, s, tenantId } = await ctx();
  if (!s.isManager) return { ok: false, error: "Only owners, admins and managers can reassign accounts." };
  const changes: Record<string, Json> = {};
  if (v.data.ownerUserId !== undefined) changes.owner_user_id = v.data.ownerUserId;
  if (v.data.tier !== undefined) changes.icp_tier = v.data.tier;
  if (v.data.preference !== undefined) {
    changes.preference = v.data.preference;
    if (v.data.reason) changes.reason = v.data.reason;
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: "Nothing to change." };
  const { data, error } = await sb.rpc("bulk_update_accounts", { p_tenant: tenantId, p_accounts: v.data.accountIds, p_changes: changes as Json });
  if (error) {
    if (error.code === "22023" || error.code === "42501") return { ok: false, error: error.message.charAt(0).toUpperCase() + error.message.slice(1) + "." };
    return { ok: false, error: dbMessage(error, "update those accounts") };
  }
  const r = (data ?? {}) as { accounts?: number; tasks_moved?: number };
  const n = r.accounts ?? 0;
  const t = r.tasks_moved ?? 0;
  revalidatePath("/app", "layout");
  const what = v.data.ownerUserId !== undefined ? (v.data.ownerUserId ? "Reassigned" : "Unassigned") : v.data.tier !== undefined ? `Set to P${v.data.tier}:` : "Updated";
  return {
    ok: true,
    accounts: n,
    tasksMoved: t,
    message: `${what} ${n} ${n === 1 ? "account" : "accounts"}${t ? ` · ${t} open ${t === 1 ? "task" : "tasks"} moved` : ""}`,
  };
}
