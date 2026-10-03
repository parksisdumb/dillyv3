"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import type { ActionState } from "@/lib/actions/state";
import type { Json } from "@/lib/db/database.types";

const schema = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "edited", "rejected"]),
  note: z.string().trim().max(1000).optional(),
  edited_payload: z.string().max(100_000).optional(),
});

export async function decideApproval(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  let edited: Json | null = null;
  if (v.decision === "edited") {
    if (!v.edited_payload) return { ok: false, error: "Paste the edited version before saving as edited." };
    try {
      edited = JSON.parse(v.edited_payload) as Json;
    } catch {
      return { ok: false, error: "The edited version isn't valid JSON." };
    }
  }
  if (v.decision === "rejected" && !v.note) return { ok: false, error: "Say why it's rejected — the agent learns from it." };
  const { sb, s, tenantId } = await ctx();
  const { data, error } = await sb
    .from("approval")
    .update({
      status: v.decision,
      reviewer_user_id: s.userId,
      decided_at: new Date().toISOString(),
      note: v.note ?? null,
      edited_payload: edited,
    })
    .eq("tenant_id", tenantId)
    .eq("id", v.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, error: dbMessage(error, "decide that approval") };
  if (!data || data.length === 0) return { ok: false, error: "Not saved — it was already decided, or this gate needs an owner or admin." };
  revalidatePath("/app", "layout");
  return { ok: true, message: v.decision === "approved" ? "Approved" : v.decision === "edited" ? "Approved with edits" : "Rejected" };
}
