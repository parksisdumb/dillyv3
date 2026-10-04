"use server";
// Pickers and links for the Book: account / contact / property search, inline account create, contact↔property links.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage, formObject, zodFail } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import type { ActionState } from "@/lib/actions/state";

export type PickOption = { id: string; label: string; sub: string | null };

export async function searchAccountOptions(q: string): Promise<PickOption[]> {
  const term = cleanQuery(q).toLowerCase();
  if (term.length < 2) return [];
  const { sb, tenantId } = await ctx();
  const { data } = await sb
    .from("account")
    .select("id,name,city,icp_tier")
    .eq("tenant_id", tenantId)
    .is("duplicate_of", null)
    .ilike("normalized_name", `%${term}%`)
    .order("icp_tier")
    .limit(8);
  return (data ?? []).map((a) => ({ id: a.id, label: a.name, sub: [`P${a.icp_tier}`, a.city].filter(Boolean).join(" · ") }));
}

export async function searchContactOptions(q: string): Promise<PickOption[]> {
  const term = cleanQuery(q);
  if (term.length < 2) return [];
  const { sb, tenantId } = await ctx();
  const { data } = await sb
    .from("contact")
    .select("id,full_name,title,email")
    .eq("tenant_id", tenantId)
    .is("duplicate_of", null)
    .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`)
    .limit(8);
  return (data ?? []).map((c) => ({ id: c.id, label: c.full_name ?? c.email ?? "Unnamed", sub: c.title }));
}

export async function searchPropertyOptions(q: string): Promise<PickOption[]> {
  const term = cleanQuery(q);
  if (term.length < 2) return [];
  const { sb, tenantId } = await ctx();
  const { data } = await sb
    .from("property")
    .select("id,name,address1,city")
    .eq("tenant_id", tenantId)
    .is("duplicate_of", null)
    .or(`name.ilike.%${term}%,address1.ilike.%${term}%,city.ilike.%${term}%`)
    .limit(8);
  return (data ?? []).map((p) => ({ id: p.id, label: p.name || p.address1 || "Unnamed property", sub: [p.address1, p.city].filter(Boolean).join(", ") || null }));
}

/** Create an account by name from a picker. Returns the existing one when the normalized name already exists. */
export async function quickCreateAccount(name: string): Promise<{ ok: true; option: PickOption; existed: boolean } | { ok: false; error: string }> {
  const n = z.string().trim().min(2, "Enter the company name").max(200).safeParse(name);
  if (!n.success) return { ok: false, error: n.error.issues[0]?.message ?? "Enter the company name" };
  const { sb, s, tenantId } = await ctx();
  const norm = n.data.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const { data: same } = await sb.from("account").select("id,name,city").eq("tenant_id", tenantId).is("duplicate_of", null).ilike("normalized_name", norm).limit(1);
  if (same && same[0]) return { ok: true, existed: true, option: { id: same[0].id, label: same[0].name, sub: same[0].city } };
  const { data, error } = await sb
    .from("account")
    .insert({ tenant_id: tenantId, name: n.data, owner_user_id: s.userId, source: "rep", created_by: s.userId })
    .select("id,name")
    .single();
  if (error || !data) return { ok: false, error: dbMessage(error, "create the account") };
  revalidatePath("/app", "layout");
  return { ok: true, existed: false, option: { id: data.id, label: data.name, sub: "New account" } };
}

const linkSchema = z.object({
  property_id: z.string().uuid("Pick a property"),
  contact_id: z.string().uuid("Pick a contact"),
  role: z.string().trim().max(60).optional(),
});

export async function linkPropertyContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = linkSchema.safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, tenantId } = await ctx();
  const { error } = await sb
    .from("property_contact")
    .upsert({ tenant_id: tenantId, property_id: parsed.data.property_id, contact_id: parsed.data.contact_id, role: parsed.data.role ?? null });
  if (error) return { ok: false, error: dbMessage(error, "link them") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Linked" };
}

export async function unlinkPropertyContact(_: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = linkSchema.pick({ property_id: true, contact_id: true }).safeParse(formObject(fd));
  if (!parsed.success) return zodFail(parsed.error);
  const { sb, tenantId } = await ctx();
  const { error } = await sb
    .from("property_contact")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("property_id", parsed.data.property_id)
    .eq("contact_id", parsed.data.contact_id);
  if (error) return { ok: false, error: dbMessage(error, "unlink them") };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Unlinked" };
}
