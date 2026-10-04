"use server";
// Ownership & management changes, company moves and condition flags. All writes go through SECURITY INVOKER
// database functions (20261004001000_property_party.sql, 20261004001100_property_flags_and_badges.sql), so RLS
// applies and the whole change is one transaction.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { FLAG_KEYS, PROPERTY_FLAGS, type PropertyFlag } from "@/lib/domain/badges-property";
import { PARTY_ROLES, type PartyRole } from "@/lib/domain/ownership";

export type OwnershipResult = { ok: true; message: string } | { ok: false; error: string };

type PgErr = { code?: string; message?: string } | null;

/** Our functions raise rep-readable messages; pass those through, map the rest. */
function why(e: PgErr, what: string): string {
  if (e?.code && ["P0001", "P0002", "22023", "23505"].includes(e.code) && e.message) {
    const m = e.message.replace(/^ERROR:\s*/, "");
    return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
  }
  return dbMessage(e, what);
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date").optional();
const ids = z.array(z.string().uuid()).max(200).default([]);
const role = z.enum(Object.keys(PARTY_ROLES) as [PartyRole, ...PartyRole[]]);

const transferSchema = z.object({
  propertyId: z.string().uuid(),
  role,
  newAccountId: z.string().uuid("Pick the new company"),
  effective: day,
  withBuilding: ids,
  withOldCompany: ids,
  note: z.string().trim().max(1000).optional(),
});

export async function transferProperty(input: z.input<typeof transferSchema>): Promise<OwnershipResult> {
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { sb } = await ctx();
  const { error } = await sb.rpc("transfer_property", {
    p_property: v.propertyId,
    p_role: v.role,
    p_new_account: v.newAccountId,
    p_effective: v.effective,
    p_contacts_with_building: v.withBuilding,
    p_contacts_with_old_company: v.withOldCompany,
    p_note: v.note || undefined,
  });
  if (error) return { ok: false, error: why(error, "record the change") };
  revalidatePath("/app", "layout");
  return { ok: true, message: `Saved. Intro task is in your queue for tomorrow.` };
}

const bulkSchema = transferSchema.omit({ propertyId: true }).extend({
  propertyIds: z.array(z.string().uuid()).min(1, "Pick at least one property").max(200),
});

export async function transferProperties(input: z.input<typeof bulkSchema>): Promise<OwnershipResult> {
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("transfer_properties", {
    p_properties: v.propertyIds,
    p_role: v.role,
    p_new_account: v.newAccountId,
    p_effective: v.effective,
    p_contacts_with_building: v.withBuilding,
    p_contacts_with_old_company: v.withOldCompany,
    p_note: v.note || undefined,
  });
  if (error) return { ok: false, error: why(error, "move the properties") };
  const n = Array.isArray(data) ? data.length : v.propertyIds.length;
  revalidatePath("/app", "layout");
  return { ok: true, message: n === 0 ? "Nothing to move — they're already there." : `Moved ${n} ${n === 1 ? "property" : "properties"}. Intro task is in your queue.` };
}

const moveSchema = z.object({
  contactId: z.string().uuid(),
  newAccountId: z.string().uuid("Pick the new company"),
  newTitle: z.string().trim().max(120).optional(),
  effective: day,
});

export async function moveContact(input: z.input<typeof moveSchema>): Promise<OwnershipResult> {
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const v = parsed.data;
  const { sb } = await ctx();
  const { error } = await sb.rpc("move_contact", {
    p_contact: v.contactId,
    p_new_account: v.newAccountId,
    p_new_title: v.newTitle || undefined,
    p_effective: v.effective,
  });
  if (error) return { ok: false, error: why(error, "move the contact") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Moved. Reconnect task is in your queue." };
}

const flagSchema = z.object({
  propertyId: z.string().uuid(),
  flag: z.enum(FLAG_KEYS as [PropertyFlag, ...PropertyFlag[]]),
  on: z.boolean(),
  note: z.string().trim().max(300).optional(),
});

export async function setPropertyFlag(input: z.input<typeof flagSchema>): Promise<OwnershipResult> {
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Unknown condition." };
  const v = parsed.data;
  const { sb } = await ctx();
  const { error } = await sb.rpc("set_property_flag", { p_property: v.propertyId, p_flag: v.flag, p_on: v.on, p_note: v.note || undefined });
  if (error) return { ok: false, error: why(error, "save that") };
  revalidatePath("/app", "layout");
  const label = PROPERTY_FLAGS[v.flag].long;
  return { ok: true, message: v.on ? `${label} flagged` : `${label} cleared` };
}
