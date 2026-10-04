"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import { teamGoalSchema } from "@/lib/domain/team-goal";
import { targetsSchema } from "@/lib/domain/scorecard";
import { MANAGER_ROLES, ROLES } from "@/lib/domain/vocab";
import type { ActionState } from "@/lib/actions/state";
import type { Json } from "@/lib/db/database.types";

const profileSchema = z.object({ full_name: z.string().trim().min(2, "Enter your name").max(120), phone: z.string().trim().max(40).optional() });

export async function saveProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = profileSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, s } = await ctx();
  const { error } = await sb.from("profile").update({ full_name: parsed.data.full_name, phone: parsed.data.phone ?? null }).eq("id", s.userId);
  if (error) return { ok: false, error: dbMessage(error, "save your profile") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Profile saved" };
}

const targetingSchema = z.object({
  dimension: z.enum(["service_line", "asset_class", "account_type", "market"]),
  value: z
    .string()
    .trim()
    .min(1, "Pick a value")
    .max(60)
    .transform((v) => v.toLowerCase().replace(/\s+/g, "_")),
  mode: z.enum(["include", "exclude"]),
  weight: z.coerce.number().min(0).max(5).optional(),
  note: z.string().trim().max(200).optional(),
});

export async function saveTargeting(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = targetingSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  const { sb, s, tenantId } = await ctx();
  if (!s.isManager) return { ok: false, error: "Only owners, admins and managers change targeting." };
  const { error } = await sb.from("tenant_targeting").upsert({
    tenant_id: tenantId,
    dimension: v.dimension,
    value: v.value,
    mode: v.mode,
    weight: v.mode === "exclude" ? 0 : v.weight ?? 1,
    note: v.note ?? null,
    updated_by: s.userId,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: dbMessage(error, "save targeting") };
  revalidatePath("/app", "layout");
  return { ok: true, message: `${v.mode === "exclude" ? "Excluding" : "Targeting"} ${v.value.replace(/_/g, " ")} — rankings update now` };
}

export async function deleteTargeting(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = targetingSchema.pick({ dimension: true, value: true }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, s, tenantId } = await ctx();
  if (!s.isManager) return { ok: false, error: "Only owners, admins and managers change targeting." };
  const { error } = await sb.from("tenant_targeting").delete().eq("tenant_id", tenantId).eq("dimension", parsed.data.dimension).eq("value", parsed.data.value);
  if (error) return { ok: false, error: dbMessage(error, "remove targeting") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Removed" };
}

export async function saveTeamGoal(_: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formObject(fd);
  const { sb, s, tenantId } = await ctx();
  if (!(s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin)) return { ok: false, error: "Only owners and admins set the team goal." };
  const { data: t, error: readErr } = await sb.from("tenant").select("settings").eq("id", tenantId).single();
  if (readErr || !t) return { ok: false, error: dbMessage(readErr, "load settings") };
  const settings = { ...((t.settings as Record<string, Json>) ?? {}) };
  if (raw.clear === "1") {
    delete settings.team_goal;
  } else {
    const parsed = teamGoalSchema.safeParse(raw);
    if (!parsed.success) return zodFail(parsed.error);
    settings.team_goal = parsed.data;
  }
  const { error } = await sb.from("tenant").update({ settings }).eq("id", tenantId);
  if (error) return { ok: false, error: dbMessage(error, "save the team goal") };
  revalidatePath("/app", "layout");
  return { ok: true, message: raw.clear === "1" ? "Team goal cleared" : "Team goal set — it shows on everyone's Today" };
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(ROLES),
  full_name: z.string().trim().max(120).optional(),
});

export async function createInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = inviteSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, s, tenantId } = await ctx();
  if (!MANAGER_ROLES.includes(s.tenant.role) && !s.isPlatformAdmin) return { ok: false, error: "Only managers and up can invite." };
  const elevated = parsed.data.role === "owner" || parsed.data.role === "admin";
  if (elevated && !(s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin))
    return { ok: false, error: "Only owners and admins can invite an owner or admin." };
  const { error } = await sb.from("invite").insert({ tenant_id: tenantId, email: parsed.data.email, role: parsed.data.role, full_name: parsed.data.full_name ?? null });
  if (error) return { ok: false, error: error.code === "23505" ? "That email is already invited." : dbMessage(error, "send the invite") };
  revalidatePath("/app/settings");
  return { ok: true, message: `Invited ${parsed.data.email}. They join on first sign-in.` };
}

export async function deleteInvite(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Unknown invite." };
  const { sb, tenantId } = await ctx();
  const { error } = await sb.from("invite").delete().eq("tenant_id", tenantId).eq("id", id.data).is("claimed_at", null);
  if (error) return { ok: false, error: dbMessage(error, "cancel the invite") };
  revalidatePath("/app/settings");
  return { ok: true, message: "Invite cancelled" };
}

/** Scorecard targets (tenant.settings.scorecard_targets). Owners and admins. Blank = no goal line. */
export async function saveScorecardTargets(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = targetsSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, s, tenantId } = await ctx();
  if (!(s.tenant.role === "owner" || s.tenant.role === "admin" || s.isPlatformAdmin)) return { ok: false, error: "Only owners and admins set targets." };
  const { data: t, error: readErr } = await sb.from("tenant").select("settings").eq("id", tenantId).single();
  if (readErr || !t) return { ok: false, error: dbMessage(readErr, "load settings") };
  const settings = { ...((t.settings as Record<string, Json>) ?? {}), scorecard_targets: parsed.data as Json };
  const { error } = await sb.from("tenant").update({ settings }).eq("id", tenantId);
  if (error) return { ok: false, error: dbMessage(error, "save the targets") };
  revalidatePath("/app/team", "layout");
  return { ok: true, message: "Targets saved" };
}
