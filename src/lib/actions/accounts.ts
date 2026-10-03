"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ctx, dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import { keysEnum, optUuid } from "@/lib/server/zod-helpers";
import { ACCOUNT_TYPES, ONBOARDING, PREFERENCES } from "@/lib/domain/vocab";
import type { ActionState } from "@/lib/actions/state";

const accountSchema = z.object({
  id: optUuid,
  name: z.string().trim().min(2, "Enter the company name").max(200),
  account_type: keysEnum(ACCOUNT_TYPES),
  icp_tier: z.coerce.number().int().min(1).max(4),
  owner_user_id: optUuid,
  phone: z.string().trim().max(40).optional(),
  website: z.string().trim().max(200).optional(),
  address1: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(40).optional(),
  zip: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export async function saveAccount(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = accountSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { id, ...v } = parsed.data;
  const { sb, s, tenantId } = await ctx();
  const row = {
    name: v.name,
    account_type: v.account_type,
    icp_tier: v.icp_tier,
    owner_user_id: v.owner_user_id ?? null,
    phone: v.phone ?? null,
    website: v.website ?? null,
    address1: v.address1 ?? null,
    city: v.city ?? null,
    state: v.state ?? null,
    zip: v.zip ?? null,
    notes: v.notes ?? null,
  };
  let accountId = id ?? null;
  if (id) {
    const { error } = await sb.from("account").update(row).eq("tenant_id", tenantId).eq("id", id);
    if (error) return { ok: false, error: dbMessage(error, "save the account") };
  } else {
    // Insert-time duplicate guard on the normalized name.
    const norm = v.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const { data: same } = await sb.from("account").select("id,name").eq("tenant_id", tenantId).is("duplicate_of", null).ilike("normalized_name", norm).limit(1);
    if (same && same.length && fd.get("force") !== "1") {
      return { ok: false, error: `“${same[0].name}” already exists. Open it instead, or tick “Create anyway”.`, fields: { name: "duplicate" } };
    }
    const { data, error } = await sb
      .from("account")
      .insert({ ...row, tenant_id: tenantId, owner_user_id: v.owner_user_id ?? s.userId, source: "rep", created_by: s.userId })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: dbMessage(error, "create the account") };
    accountId = data.id;
  }
  revalidatePath("/app", "layout");
  redirect(`/app/accounts/${accountId}`);
}

const prefSchema = z.object({
  account_id: z.string().uuid(),
  preference: z.union([keysEnum(PREFERENCES), z.literal("none")]),
  reason: z.string().trim().max(300).optional(),
});

export async function setPreference(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = prefSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { account_id, preference, reason } = parsed.data;
  const { sb, s, tenantId } = await ctx();
  if (preference === "none") {
    const { error } = await sb.from("account_preference").delete().eq("tenant_id", tenantId).eq("account_id", account_id);
    if (error) return { ok: false, error: dbMessage(error, "clear the preference") };
  } else {
    if ((preference === "do_not_pursue" || preference === "competitor") && !reason)
      return { ok: false, error: "Say why — the team will see it on the account.", fields: { reason: "required" } };
    const { error } = await sb.from("account_preference").upsert({
      tenant_id: tenantId,
      account_id,
      preference,
      reason: reason ?? null,
      set_by: s.userId,
      set_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: dbMessage(error, "set the preference") };
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: preference === "none" ? "Preference cleared" : `Marked ${PREFERENCES[preference].label.toLowerCase()}` };
}

const onboardingSchema = z.object({ accountId: z.string().uuid(), status: keysEnum(ONBOARDING) });

export async function setOnboarding(accountId: string, status: string): Promise<ActionState> {
  const parsed = onboardingSchema.safeParse({ accountId, status });
  if (!parsed.success) return { ok: false, error: "Unknown step." };
  const { sb, s, tenantId } = await ctx();
  const t0 = new Date(Date.now() - 2000).toISOString();
  const { error } = await sb.from("account").update({ onboarding_status: parsed.data.status }).eq("tenant_id", tenantId).eq("id", accountId);
  if (error) return { ok: false, error: dbMessage(error, "update onboarding") };
  const { data: pts } = await sb
    .from("point_event")
    .select("points")
    .eq("tenant_id", tenantId)
    .eq("user_id", s.userId)
    .eq("account_id", accountId)
    .eq("event", "onboarding_step")
    .gte("occurred_at", t0);
  const earned = (pts ?? []).reduce((n, p) => n + p.points, 0);
  revalidatePath("/app", "layout");
  return { ok: true, message: `Onboarding: ${ONBOARDING[parsed.data.status]}${earned ? ` · +${earned}` : ""}` };
}
