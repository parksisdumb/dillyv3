import "server-only";
// The rep's working list for Go: active pursuits first (stale first), then buildings from lists assigned to them that
// nobody has touched in 14 days. Capped at 25. Do-not-pursue / competitor accounts and buildings with an appointment
// today (pass them in `excludePropertyIds`; they show in the appointment section) are left out.
import { supabaseServer } from "@/lib/supabase/server";
import { localDate, mapsUrl } from "@/lib/format";
import { propertyBadges, type PropertyBadge } from "@/lib/domain/badges-property";
import { loadProperties } from "@/lib/server/book";
import { parseStoredFilter } from "@/lib/lists/filter";
import { orderWorkingList, WORKING_CAP, type ListItemIn } from "@/lib/lists/order";
import type { Stop } from "@/components/go/types";

export type WorkingListStop = {
  propertyId: string;
  accountId: string | null;
  /** Account (manager/owner) name for the stop header; null when the building has no account yet. */
  accountName: string | null;
  tier: number | null;
  /** Building name (falls back to the street address). */
  name: string;
  address1: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  badges: PropertyBadge[];
  /** Active condition flags (ConditionToggles on the stop). */
  flags: string[];
  /** "Active · going stale — quiet 34d", "Warranty ending in 12 months · never touched". */
  reason: string;
  /** The assigned list it came from; null for an active pursuit. */
  listName: string | null;
  source: "active" | "list";
  stale: boolean;
  lastTouchAt: string | null;
  directions: string | null;
  mapsAddress: string | null;
};

type Opts = { excludePropertyIds?: Iterable<string>; cap?: number; now?: Date };

async function chunked<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null }>, size = 100): Promise<T[]> {
  const parts: string[][] = [];
  for (let i = 0; i < ids.length; i += size) parts.push(ids.slice(i, i + size));
  const res = await Promise.all(parts.map(run));
  return res.flatMap((r) => r.data ?? []);
}

/**
 * Ordered stops for the signed-in rep (`userId` must be the session user: reads run with their RLS).
 * Shape matches Go's stops; `toGoStop()` converts one to the `Stop` the field session renders.
 */
export async function getMyWorkingListStops(tenantId: string, userId: string, opts: Opts = {}): Promise<WorkingListStop[]> {
  const sb = await supabaseServer();
  const now = opts.now ?? new Date();
  const cap = opts.cap ?? WORKING_CAP;
  const { data: tenant } = await sb.from("tenant").select("timezone").eq("id", tenantId).maybeSingle();
  const today = localDate(tenant?.timezone ?? "America/Chicago");
  const c = { sb, tenantId, today, s: { userId } };

  const [pursuits, assigned] = await Promise.all([
    sb.from("property_pursuit").select("property_id,started_at").eq("tenant_id", tenantId).eq("user_id", userId).eq("status", "active").order("started_at").limit(300),
    sb.from("list_assignment").select("list_id,assigned_at").eq("tenant_id", tenantId).eq("user_id", userId).order("assigned_at").limit(50),
  ]);
  const listIds = (assigned.data ?? []).map((a) => a.list_id);
  const { data: lists } = listIds.length
    ? await sb.from("list").select("id,name,kind,filter,archived_at").eq("tenant_id", tenantId).in("id", listIds).is("archived_at", null)
    : { data: [] };
  const byId = new Map((lists ?? []).map((l) => [l.id, l]));

  // Items from assigned lists, in assignment order then list order.
  const items: { propertyId: string; listId: string; listName: string; ord: number }[] = [];
  await Promise.all(
    listIds.map(async (id, i) => {
      const l = byId.get(id);
      if (!l) return;
      let ids: string[];
      if (l.kind === "smart") {
        const r = await loadProperties(c, parseStoredFilter(l.filter), { facets: false, max: 200 });
        ids = r.rows.map((x) => x.id);
      } else {
        const { data } = await sb.from("list_item").select("property_id,position").eq("list_id", id).order("position").order("added_at").limit(500);
        ids = (data ?? []).map((x) => x.property_id);
      }
      ids.forEach((pid, j) => items.push({ propertyId: pid, listId: id, listName: l.name, ord: i * 10_000 + j }));
    }),
  );
  items.sort((a, b) => a.ord - b.ord);

  const active = pursuits.data ?? [];
  const candidates = [...new Set([...active.map((a) => a.property_id), ...items.map((i) => i.propertyId)])];
  if (candidates.length === 0) return [];

  const [props, touches] = await Promise.all([
    chunked(candidates, (ch) =>
      sb
        .from("property_current")
        .select(
          "id,name,address1,city,state,lat,lng,account_id,current_manager_id,current_owner_id,duplicate_of,is_test,roof_system,roof_install_year,warranty_expires_on,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at",
        )
        .eq("tenant_id", tenantId)
        .in("id", ch),
    ),
    chunked(candidates, (ch) =>
      sb.from("touch").select("property_id,occurred_at").eq("tenant_id", tenantId).in("property_id", ch).is("voided_at", null).order("occurred_at", { ascending: false }).limit(1000),
    ),
  ]);
  const last = new Map<string, string>();
  for (const t of touches) if (t.property_id && !last.has(t.property_id)) last.set(t.property_id, t.occurred_at);
  const prop = new Map(props.filter((p) => p.id && !p.duplicate_of && !p.is_test).map((p) => [p.id!, p]));

  const acctIds = [...new Set(props.flatMap((p) => [p.account_id, p.current_manager_id, p.current_owner_id]).filter((x): x is string => !!x))];
  const [accts, prefs] = await Promise.all([
    chunked(acctIds, (ch) => sb.from("account").select("id,name,icp_tier").in("id", ch)),
    chunked(acctIds, (ch) =>
      sb
        .from("account_preference")
        .select("account_id,preference,expires_on")
        .eq("tenant_id", tenantId)
        .in("account_id", ch)
        .in("preference", ["do_not_pursue", "competitor"]),
    ),
  ]);
  const blocked = new Set(prefs.filter((p) => !p.expires_on || p.expires_on >= today).map((p) => p.account_id));
  const acct = new Map(accts.map((a) => [a.id, a]));

  const exclude = new Set<string>(opts.excludePropertyIds ?? []);
  for (const id of candidates) {
    const p = prop.get(id);
    if (!p) exclude.add(id);
    else if ([p.account_id, p.current_manager_id, p.current_owner_id].some((a) => a && blocked.has(a))) exclude.add(id);
  }

  const ordered = orderWorkingList(
    active.map((a) => ({ propertyId: a.property_id, startedAt: a.started_at, lastTouchAt: last.get(a.property_id) ?? null })),
    items.map((i): ListItemIn => ({ propertyId: i.propertyId, listId: i.listId, listName: i.listName, lastTouchAt: last.get(i.propertyId) ?? null })),
    { now, exclude, cap },
  );

  return ordered.map((o) => {
    const p = prop.get(o.propertyId)!;
    const accountId = p.current_manager_id ?? p.account_id ?? p.current_owner_id ?? null;
    const a = accountId ? acct.get(accountId) : undefined;
    const place = [p.address1, p.city, p.state];
    return {
      propertyId: o.propertyId,
      accountId,
      accountName: a?.name ?? null,
      tier: a?.icp_tier ?? null,
      name: p.name || p.address1 || "Unnamed property",
      address1: p.address1,
      city: p.city,
      state: p.state,
      lat: p.lat == null ? null : Number(p.lat),
      lng: p.lng == null ? null : Number(p.lng),
      badges: propertyBadges(p, today),
      flags: p.active_flags ?? [],
      reason: o.reason,
      listName: o.listName,
      source: o.source,
      stale: o.stale,
      lastTouchAt: o.lastTouchAt,
      directions: mapsUrl(place),
      mapsAddress: place.filter(Boolean).join(", ") || null,
    };
  });
}

/** One working-list stop in the shape Go's field session renders (contacts load on the stop as before). */
export function toGoStop(w: WorkingListStop): Stop {
  return {
    accountId: w.accountId ?? "",
    accountName: w.accountName ?? w.name,
    tier: w.tier,
    propertyId: w.propertyId,
    place: w.name,
    address: w.address1,
    city: w.city ?? "No address",
    reason: w.reason,
    directions: w.directions,
    contacts: [],
    fromQueue: false,
    badges: w.badges,
    flags: w.flags,
    lat: w.lat,
    lng: w.lng,
    mapsAddress: w.mapsAddress,
  };
}
