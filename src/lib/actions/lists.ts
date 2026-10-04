"use server";
// Active pursuit + lists. Every write goes through the signed-in user's client: RLS and set_pursuit() decide.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ctx, dbMessage } from "@/lib/server/ctx";
import { cleanFilter, isEmptyFilter } from "@/lib/lists/filter";
import { loadList, listRows } from "@/lib/server/lists";
import type { Json } from "@/lib/db/database.types";

export type ListResult = { ok: true; message: string; id?: string; n?: number } | { ok: false; error: string };

const ids = z.array(z.string().uuid()).min(1, "Pick at least one property").max(500, "Up to 500 at a time");
const STATUS = ["active", "paused", "won", "lost", "dropped"] as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function refresh() {
  revalidatePath("/app", "layout");
}

/** Start or end pursuit of one or more buildings for me. */
export async function setPursuit(input: { propertyIds: string[]; status: (typeof STATUS)[number]; note?: string }): Promise<ListResult> {
  const v = z.object({ propertyIds: ids, status: z.enum(STATUS), note: z.string().trim().max(500).optional() }).safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Check the selection." };
  const { sb } = await ctx();
  const { data, error } = await sb.rpc("set_pursuit", { p_properties: v.data.propertyIds, p_status: v.data.status, p_note: v.data.note });
  if (error) return { ok: false, error: dbMessage(error, "update active properties") };
  const n = Number(data ?? 0);
  refresh();
  const one = v.data.propertyIds.length === 1;
  if (v.data.status === "active") {
    return { ok: true, n, message: one ? (n ? "Marked active — it's on your Go list" : "Already active") : `${plural(n, "property", "properties")} marked active` };
  }
  return { ok: true, n, message: one ? (v.data.status === "paused" ? "Paused" : v.data.status === "dropped" ? "No longer active" : `Marked ${v.data.status}`) : `${plural(n, "property", "properties")} updated` };
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the list").max(120),
  description: z.string().trim().max(500).optional(),
  mode: z.enum(["smart", "snapshot", "empty"]),
  visibility: z.enum(["private", "team"]).default("private"),
  filter: z.record(z.string(), z.string()).default({}),
  propertyIds: z.array(z.string().uuid()).max(2000).optional(),
});

/**
 * Save as list. smart = keep the filter (updates itself); snapshot = today's matches as a static list;
 * empty = a static list to add to by hand (optionally with `propertyIds`).
 */
export async function createList(input: z.input<typeof createSchema>): Promise<ListResult> {
  const v = createSchema.safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Check the list." };
  const c = await ctx();
  const { sb, s, tenantId } = c;
  const filter = cleanFilter(v.data.filter);
  if (v.data.mode !== "empty" && isEmptyFilter(filter) && !v.data.propertyIds?.length) return { ok: false, error: "Pick a filter first — this would be every property." };
  const visibility = v.data.visibility === "team" && !s.isManager ? "private" : v.data.visibility;
  const { data: list, error } = await sb
    .from("list")
    .insert({
      tenant_id: tenantId,
      name: v.data.name,
      description: v.data.description ?? null,
      kind: v.data.mode === "smart" ? "smart" : "static",
      filter: (v.data.mode === "smart" ? filter : {}) as Json,
      owner_user_id: s.userId,
      visibility,
      created_from: v.data.mode === "empty" ? "manual" : "filter",
    })
    .select("id")
    .single();
  if (error || !list) return { ok: false, error: dbMessage(error, "save the list") };
  let n = 0;
  let add: string[] = v.data.propertyIds ?? [];
  if (v.data.mode === "snapshot") add = (await listRows(c, { id: list.id, kind: "smart", filter }, {}, 2000)).rows.map((r) => r.id);
  if (add.length) {
    const r = await insertItems(c, list.id, add, 0);
    if (!r.ok) return r;
    n = r.n ?? 0;
  }
  refresh();
  return {
    ok: true,
    id: list.id,
    n,
    message: v.data.mode === "smart" ? `Saved “${v.data.name}” — it updates as buildings change` : `Saved “${v.data.name}” · ${plural(n, "property", "properties")}`,
  };
}

async function insertItems(c: Awaited<ReturnType<typeof ctx>>, listId: string, propertyIds: string[], start: number): Promise<ListResult> {
  const uniq = [...new Set(propertyIds)];
  let n = 0;
  for (let i = 0; i < uniq.length; i += 500) {
    const rows = uniq.slice(i, i + 500).map((pid, j) => ({ list_id: listId, tenant_id: c.tenantId, property_id: pid, added_by: c.s.userId, position: start + i + j + 1 }));
    const { data, error } = await c.sb.from("list_item").upsert(rows, { onConflict: "list_id,property_id", ignoreDuplicates: true }).select("property_id");
    if (error) return { ok: false, error: dbMessage(error, "add to the list") };
    n += data?.length ?? 0;
  }
  return { ok: true, n, message: "" };
}

/** Add buildings to a static list (from row multi-select or the property page). */
export async function addToList(input: { listId: string; propertyIds: string[] }): Promise<ListResult> {
  const v = z.object({ listId: z.string().uuid(), propertyIds: ids }).safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Pick a list." };
  const c = await ctx();
  const list = await loadList(c, v.data.listId);
  if (!list) return { ok: false, error: "That list is gone." };
  if (list.kind !== "static") return { ok: false, error: "Smart lists fill themselves from their filter." };
  const { data: last } = await c.sb.from("list_item").select("position").eq("list_id", list.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const r = await insertItems(c, list.id, v.data.propertyIds, last?.position ?? 0);
  if (!r.ok) return r;
  refresh();
  const n = r.n ?? 0;
  return { ok: true, n, message: n ? `Added ${plural(n, "property", "properties")} to “${list.name}”` : `Already on “${list.name}”` };
}

export async function removeFromList(input: { listId: string; propertyIds: string[] }): Promise<ListResult> {
  const v = z.object({ listId: z.string().uuid(), propertyIds: ids }).safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Pick properties." };
  const { sb, tenantId } = await ctx();
  const { data, error } = await sb.from("list_item").delete().eq("tenant_id", tenantId).eq("list_id", v.data.listId).in("property_id", v.data.propertyIds).select("property_id");
  if (error) return { ok: false, error: dbMessage(error, "remove from the list") };
  const n = data?.length ?? 0;
  if (n === 0) return { ok: false, error: "You can only change lists you own (or any list, as a manager)." };
  refresh();
  return { ok: true, n, message: `Removed ${plural(n, "property", "properties")}` };
}

/** Managers hand a list to reps (replaces the assignee set). */
export async function assignList(input: { listId: string; userIds: string[] }): Promise<ListResult> {
  const v = z.object({ listId: z.string().uuid(), userIds: z.array(z.string().uuid()).max(100) }).safeParse(input);
  if (!v.success) return { ok: false, error: "Pick reps." };
  const c = await ctx();
  const { sb, s, tenantId } = c;
  if (!s.isManager) return { ok: false, error: "Only owners, admins and managers assign lists." };
  const list = await loadList(c, v.data.listId);
  if (!list) return { ok: false, error: "That list is gone." };
  const { data: cur } = await sb.from("list_assignment").select("user_id").eq("list_id", list.id);
  const have = new Set((cur ?? []).map((x) => x.user_id));
  const want = new Set(v.data.userIds);
  const add = [...want].filter((u) => !have.has(u));
  const drop = [...have].filter((u) => !want.has(u));
  if (add.length) {
    const { error } = await sb.from("list_assignment").insert(add.map((u) => ({ list_id: list.id, tenant_id: tenantId, user_id: u, assigned_by: s.userId })));
    if (error) return { ok: false, error: dbMessage(error, "assign the list") };
  }
  if (drop.length) {
    const { error } = await sb.from("list_assignment").delete().eq("list_id", list.id).in("user_id", drop);
    if (error) return { ok: false, error: dbMessage(error, "unassign the list") };
  }
  // A private list handed to reps becomes a team list so they (and other managers) can open it.
  if (want.size && list.visibility === "private") await sb.from("list").update({ visibility: "team" }).eq("id", list.id);
  refresh();
  return { ok: true, message: want.size ? `Assigned to ${plural(want.size, "rep")} — it's on their Lists and Go` : "Unassigned" };
}

export async function updateList(input: { listId: string; name?: string; description?: string | null; visibility?: "private" | "team"; archived?: boolean }): Promise<ListResult> {
  const v = z
    .object({
      listId: z.string().uuid(),
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(500).nullable().optional(),
      visibility: z.enum(["private", "team"]).optional(),
      archived: z.boolean().optional(),
    })
    .safeParse(input);
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? "Check the list." };
  const { sb, tenantId } = await ctx();
  const patch: { name?: string; description?: string | null; visibility?: string; archived_at?: string | null } = {};
  if (v.data.name !== undefined) patch.name = v.data.name;
  if (v.data.description !== undefined) patch.description = v.data.description || null;
  if (v.data.visibility) patch.visibility = v.data.visibility;
  if (v.data.archived !== undefined) patch.archived_at = v.data.archived ? new Date().toISOString() : null;
  const { data, error } = await sb.from("list").update(patch).eq("tenant_id", tenantId).eq("id", v.data.listId).select("id");
  if (error) return { ok: false, error: dbMessage(error, "update the list") };
  if (!data?.length) return { ok: false, error: "You can only change lists you own (or any list, as a manager)." };
  refresh();
  return { ok: true, message: v.data.archived === true ? "List archived" : v.data.archived === false ? "List restored" : "List saved" };
}

/** After a log at a building: should we suggest "Mark <name> active?" (only when I'm not already pursuing it). */
export async function pursuitHint(propertyId: string): Promise<{ suggest: boolean; name: string }> {
  if (!z.string().uuid().safeParse(propertyId).success) return { suggest: false, name: "" };
  const { sb, s, tenantId } = await ctx();
  const [p, mine] = await Promise.all([
    sb.from("property").select("name,address1").eq("tenant_id", tenantId).eq("id", propertyId).maybeSingle(),
    sb.from("property_pursuit").select("id").eq("tenant_id", tenantId).eq("property_id", propertyId).eq("user_id", s.userId).eq("status", "active").maybeSingle(),
  ]);
  if (!p.data) return { suggest: false, name: "" };
  return { suggest: !mine.data, name: p.data.name || p.data.address1 || "this building" };
}
