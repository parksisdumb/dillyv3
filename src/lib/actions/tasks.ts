"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { dueLabel, nextBusinessDay } from "@/lib/format";
import type { ActionState } from "@/lib/actions/state";
import { MAX_SNOOZES } from "@/lib/domain/tasks";

const id = z.string().uuid();

export async function completeTask(taskId: string): Promise<ActionState> {
  if (!id.safeParse(taskId).success) return { ok: false, error: "Unknown task." };
  const { sb, tenantId } = await ctx();
  const { error } = await sb
    .from("task")
    .update({ status: "done", completed_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("id", taskId)
    .eq("status", "open");
  if (error) return { ok: false, error: dbMessage(error, "close that task") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Done — off the list" };
}

export async function snoozeTask(taskId: string): Promise<ActionState> {
  if (!id.safeParse(taskId).success) return { ok: false, error: "Unknown task." };
  const { sb, tenantId, today } = await ctx();
  const { data: t, error: readErr } = await sb.from("task").select("id,due_on,snooze_count,status").eq("tenant_id", tenantId).eq("id", taskId).single();
  if (readErr || !t) return { ok: false, error: dbMessage(readErr, "find that task") };
  if (t.snooze_count >= MAX_SNOOZES) return { ok: false, error: "Snoozed 3 times already — drop it or mark the account do-not-pursue." };
  const from = t.due_on > today ? t.due_on : today;
  const due = nextBusinessDay(from);
  const { error } = await sb
    .from("task")
    .update({ due_on: due, snooze_count: t.snooze_count + 1 })
    .eq("tenant_id", tenantId)
    .eq("id", taskId);
  if (error) return { ok: false, error: dbMessage(error, "snooze that task") };
  revalidatePath("/app", "layout");
  return { ok: true, message: `Snoozed to ${dueLabel(due, today)}` };
}

const dropSchema = z.object({
  taskId: id,
  doNotPursue: z.boolean().optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function dropTask(input: { taskId: string; doNotPursue?: boolean; reason?: string }): Promise<ActionState> {
  const parsed = dropSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown task." };
  const { sb, s, tenantId } = await ctx();
  const { data: t } = await sb.from("task").select("account_id").eq("tenant_id", tenantId).eq("id", parsed.data.taskId).single();
  if (parsed.data.doNotPursue) {
    if (!t?.account_id) return { ok: false, error: "This task isn't tied to an account." };
    const { error: pErr } = await sb.from("account_preference").upsert({
      tenant_id: tenantId,
      account_id: t.account_id,
      preference: "do_not_pursue",
      reason: parsed.data.reason || "Snoozed out of the queue",
      set_by: s.userId,
      set_at: new Date().toISOString(),
    });
    if (pErr) return { ok: false, error: dbMessage(pErr, "mark that account") };
  }
  const { error } = await sb.from("task").update({ status: "dropped" }).eq("tenant_id", tenantId).eq("id", parsed.data.taskId);
  if (error) return { ok: false, error: dbMessage(error, "drop that task") };
  revalidatePath("/app", "layout");
  return { ok: true, message: parsed.data.doNotPursue ? "Dropped · account off the list" : "Dropped" };
}
