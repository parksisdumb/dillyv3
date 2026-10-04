"use server";
// Contacts (edit), properties and opportunities. Contact creation goes through quickCreateContact (log.ts) for the dedupe prompt.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ctx, dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import { keysEnum, optUuid, splitName } from "@/lib/server/zod-helpers";
import { OPEN_STAGES, PERSONA_ROLES, SERVICE_LINES, STAGES } from "@/lib/domain/vocab";
import type { ActionState } from "@/lib/actions/state";
import { normalizeAddress } from "@/lib/domain/book";

const optStr = (max: number) => z.string().trim().max(max).optional();
const optNum = z.coerce.number().nonnegative().optional();

// --- Contact -------------------------------------------------------------------------------------------
const contactSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(2, "Enter a name").max(120),
  title: optStr(120),
  persona_role: keysEnum(PERSONA_ROLES),
  email: z.union([z.string().trim().email("Email looks wrong"), z.literal("")]).optional(),
  phone: optStr(40),
  mobile: optStr(40),
  linkedin_url: optStr(300),
  account_id: optUuid,
  notes: optStr(4000),
  do_not_contact: z.literal("on").optional(),
});

export async function saveContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = contactSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const v = parsed.data;
  const { sb, tenantId } = await ctx();
  const { error } = await sb
    .from("contact")
    .update({
      ...splitName(v.full_name),
      title: v.title ?? null,
      persona_role: v.persona_role,
      email: v.email || null,
      phone: v.phone ?? null,
      mobile: v.mobile ?? null,
      linkedin_url: v.linkedin_url ?? null,
      account_id: v.account_id ?? null,
      notes: v.notes ?? null,
      do_not_contact: v.do_not_contact === "on",
    })
    .eq("tenant_id", tenantId)
    .eq("id", v.id);
  if (error) return { ok: false, error: dbMessage(error, "save the contact") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Contact saved" };
}

// --- Property ------------------------------------------------------------------------------------------
const propertySchema = z.object({
  id: optUuid,
  account_id: optUuid,
  name: optStr(200),
  address1: optStr(200),
  city: optStr(100),
  state: optStr(40),
  zip: optStr(20),
  asset_class: optStr(60),
  roof_system: optStr(60),
  roof_area_sf: optNum,
  roof_install_year: z.coerce.number().int().min(1900).max(2100).optional(),
  warranty_expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  building_count: z.coerce.number().int().min(0).max(10000).optional(),
  notes: optStr(4000),
});

export async function saveProperty(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = propertySchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { id, ...v } = parsed.data;
  if (!v.name && !v.address1) return { ok: false, error: "Give the property a name or an address.", fields: { address1: "required" } };
  const { sb, s, tenantId } = await ctx();
  const row = {
    account_id: v.account_id ?? null,
    name: v.name ?? null,
    address1: v.address1 ?? null,
    city: v.city ?? null,
    state: v.state ?? null,
    zip: v.zip ?? null,
    asset_class: v.asset_class ?? null,
    roof_system: v.roof_system ?? null,
    roof_area_sf: v.roof_area_sf ?? null,
    roof_install_year: v.roof_install_year ?? null,
    warranty_expires_on: v.warranty_expires_on ?? null,
    building_count: v.building_count ?? null,
    notes: v.notes ?? null,
  };
  if (id) {
    const { error } = await sb.from("property").update(row).eq("tenant_id", tenantId).eq("id", id);
    if (error) return { ok: false, error: dbMessage(error, "save the property") };
  } else {
    const norm = normalizeAddress(v.address1, v.city);
    if (norm && fd.get("force") !== "1") {
      const { data: same } = await sb
        .from("property")
        .select("id,name,address1")
        .eq("tenant_id", tenantId)
        .is("duplicate_of", null)
        .eq("normalized_address", norm)
        .limit(1);
      if (same && same.length)
        return { ok: false, error: `${same[0].name ?? same[0].address1} is already at that address. Open it, or tick “Create anyway” if it's a different building.` };
    }
    const { data, error } = await sb.from("property").insert({ ...row, tenant_id: tenantId, source: "rep", created_by: s.userId }).select("id").single();
    if (error || !data) return { ok: false, error: dbMessage(error, "add the property") };
    revalidatePath("/app", "layout");
    redirect(`/app/properties/${data.id}`);
  }
  revalidatePath("/app", "layout");
  return { ok: true, message: "Property saved" };
}

// --- Opportunity ---------------------------------------------------------------------------------------
const oppSchema = z
  .object({
    id: optUuid,
    account_id: optUuid,
    property_id: optUuid,
    primary_contact_id: optUuid,
    name: z.string().trim().min(2, "Name the job").max(200),
    service_line: keysEnum(SERVICE_LINES),
    stage: keysEnum(STAGES),
    value_estimate: optNum,
    gross_profit_estimate: optNum,
    next_step: optStr(200),
    next_step_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    owner_user_id: optUuid,
  })
  .refine((v) => !OPEN_STAGES.includes(v.stage) || (v.next_step && v.next_step_due), {
    message: "Open jobs need a next step and a date",
    path: ["next_step"],
  })
  .refine((v) => v.stage !== "lost", { message: "Use “Mark lost” so the reason is captured", path: ["stage"] });

export async function saveOpportunity(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = oppSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { id, ...v } = parsed.data;
  const { sb, s, tenantId } = await ctx();
  const row = {
    account_id: v.account_id ?? null,
    property_id: v.property_id ?? null,
    primary_contact_id: v.primary_contact_id ?? null,
    name: v.name,
    service_line: v.service_line,
    stage: v.stage,
    value_estimate: v.value_estimate ?? null,
    gross_profit_estimate: v.gross_profit_estimate ?? null,
    next_step: v.next_step ?? null,
    next_step_due: v.next_step_due ?? null,
    owner_user_id: v.owner_user_id ?? s.userId,
  };
  let oppId = id;
  if (id) {
    const { error } = await sb.from("opportunity").update(row).eq("tenant_id", tenantId).eq("id", id);
    if (error) return { ok: false, error: dbMessage(error, "save the opportunity") };
  } else {
    const { data, error } = await sb.from("opportunity").insert({ ...row, tenant_id: tenantId, source: "rep", created_by: s.userId }).select("id").single();
    if (error || !data) return { ok: false, error: dbMessage(error, "create the opportunity") };
    oppId = data.id;
  }
  revalidatePath("/app", "layout");
  redirect(`/app/pipeline/${oppId}`);
}

export async function markWon(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = z.string().uuid().safeParse(fd.get("id"));
  if (!id.success) return { ok: false, error: "Unknown opportunity." };
  const { sb, tenantId } = await ctx();
  const { error } = await sb.from("opportunity").update({ stage: "won" }).eq("tenant_id", tenantId).eq("id", id.data);
  if (error) return { ok: false, error: dbMessage(error, "mark it won") };
  await sb.from("task").update({ status: "done", completed_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("opportunity_id", id.data).eq("kind", "next_step").eq("status", "open");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Marked won" };
}

const lostSchema = z.object({ id: z.string().uuid(), lost_reason: z.string().trim().min(3, "Say why it was lost").max(300) });

export async function markLost(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = lostSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, tenantId } = await ctx();
  const { error } = await sb
    .from("opportunity")
    .update({ stage: "lost", lost_reason: parsed.data.lost_reason })
    .eq("tenant_id", tenantId)
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: dbMessage(error, "mark it lost") };
  await sb.from("task").update({ status: "dropped" }).eq("tenant_id", tenantId).eq("opportunity_id", parsed.data.id).eq("kind", "next_step").eq("status", "open");
  revalidatePath("/app", "layout");
  return { ok: true, message: "Marked lost — reason saved" };
}
