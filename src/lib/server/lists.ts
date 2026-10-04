import "server-only";
import type { Ctx } from "@/lib/server/ctx";
import { loadProperties, type PropertyListRow, type PropertySP } from "@/lib/server/book";
import { parseStoredFilter, type ListFilter } from "@/lib/lists/filter";

/** What loadProperties needs from a context (a full Ctx, or the slim one getMyWorkingListStops builds). */
export type ListCtx = Pick<Ctx, "sb" | "tenantId" | "today"> & { s: { userId: string } };

export type ListRow = {
  id: string;
  name: string;
  description: string | null;
  kind: "static" | "smart";
  filter: ListFilter;
  visibility: "private" | "team";
  created_from: "manual" | "filter" | "import" | "system";
  owner_user_id: string | null;
  import_batch_id: string | null;
  archived_at: string | null;
  created_at: string;
};

const LIST_COLS = "id,name,description,kind,filter,visibility,created_from,owner_user_id,import_batch_id,archived_at,created_at";

function toListRow(r: Record<string, unknown>): ListRow {
  return { ...(r as unknown as ListRow), filter: parseStoredFilter(r.filter) };
}

/** Lists this person can see in the active company (RLS decides), newest first; system lists last. */
export async function loadLists(c: ListCtx, opts: { includeArchived?: boolean } = {}): Promise<ListRow[]> {
  let q = c.sb.from("list").select(LIST_COLS).eq("tenant_id", c.tenantId).eq("entity", "property");
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(300);
  if (error) throw new Error(`lists: ${error.message}`);
  return (data ?? []).map((r) => toListRow(r));
}

export async function loadList(c: ListCtx, id: string): Promise<ListRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await c.sb.from("list").select(LIST_COLS).eq("tenant_id", c.tenantId).eq("id", id).maybeSingle();
  if (error) throw new Error(`list ${id}: ${error.message}`);
  return data ? toListRow(data) : null;
}

/** list_id → assigned user ids. */
export async function loadAssignments(c: ListCtx, listIds?: string[]): Promise<Map<string, { user_id: string; assigned_at: string }[]>> {
  let q = c.sb.from("list_assignment").select("list_id,user_id,assigned_at").eq("tenant_id", c.tenantId);
  if (listIds) q = q.in("list_id", listIds.length ? listIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data } = await q.limit(2000);
  const m = new Map<string, { user_id: string; assigned_at: string }[]>();
  for (const a of data ?? []) m.set(a.list_id, [...(m.get(a.list_id) ?? []), { user_id: a.user_id, assigned_at: a.assigned_at }]);
  return m;
}

/**
 * A list's buildings as Properties-list rows. Smart lists run their filter over the book; static lists read their
 * items (list order unless `sp.sort` asks otherwise). `sp` adds view params (sort, near) on top.
 */
export async function listRows(
  c: ListCtx,
  list: Pick<ListRow, "id" | "kind" | "filter">,
  sp: PropertySP = {},
  max = 400,
): Promise<{ rows: PropertyListRow[]; total: number; capped: boolean; error: string | null }> {
  const res =
    list.kind === "smart"
      ? await loadProperties(c, { ...list.filter, ...sp }, { facets: false, max })
      : await loadProperties(c, sp, { listId: list.id, facets: false, max });
  return { rows: res.rows, total: res.total ?? res.rows.length, capped: res.capped, error: res.error };
}

/** Building counts per list (smart lists are evaluated; static lists count their items). */
export async function listCounts(c: ListCtx, lists: Pick<ListRow, "id" | "kind" | "filter">[]): Promise<Map<string, { n: number; capped: boolean }>> {
  const out = new Map<string, { n: number; capped: boolean }>();
  const statics = lists.filter((l) => l.kind === "static").map((l) => l.id);
  // One head count per static list (PostgREST caps row responses; counts are exact).
  const [items, smart] = await Promise.all([
    Promise.all(
      statics.map(async (id) => {
        const { count } = await c.sb
          .from("list_property_current")
          .select("list_id", { count: "exact", head: true })
          .eq("list_id", id)
          .is("duplicate_of", null)
          .eq("is_test", false);
        return [id, count ?? 0] as const;
      }),
    ),
    Promise.all(
      lists
        .filter((l) => l.kind === "smart")
        .map(async (l) => {
          const r = await loadProperties(c, l.filter, { facets: false, max: 500 });
          return [l.id, { n: r.total ?? r.rows.length, capped: (r.total ?? 0) >= 500 }] as const;
        }),
    ),
  ]);
  for (const [id, n] of items) out.set(id, { n, capped: false });
  for (const [id, v] of smart) out.set(id, v);
  return out;
}

/** My active pursuits (property ids, oldest first). */
export async function myActiveIds(c: ListCtx): Promise<{ property_id: string; started_at: string }[]> {
  const { data } = await c.sb
    .from("property_pursuit")
    .select("property_id,started_at")
    .eq("tenant_id", c.tenantId)
    .eq("user_id", c.s.userId)
    .eq("status", "active")
    .order("started_at")
    .limit(300);
  return data ?? [];
}

/** "12 of 40 touched in the last 30 days" for a set of rows. */
export function listProgress(rows: Pick<PropertyListRow, "days">[], withinDays = 30): { touched: number; total: number } {
  return { touched: rows.filter((r) => r.days != null && r.days <= withinDays).length, total: rows.length };
}
