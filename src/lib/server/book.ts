import "server-only";
import { haversineMiles } from "@/lib/geo/route";
import type { Ctx } from "@/lib/server/ctx";
import { cleanQuery } from "@/lib/server/zod-helpers";
import { PERSONA_ROLES } from "@/lib/domain/vocab";
import { phoneDigitsClause } from "@/lib/domain/phone-search";
import { ageBandYears, daysSince, isGoingQuiet, type AgeBand } from "@/lib/domain/book";
import { duplicateGroups } from "@/lib/domain/dupes";
import { addDays } from "@/lib/format";
import { propertyBadges, type PropertyBadge } from "@/lib/domain/badges-property";
import { DAMAGE_FLAGS } from "@/lib/lists/filter";

/** Run an `.in()` query in chunks so long id lists don't blow the URL length. */
async function inChunks<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null }>, size = 100): Promise<T[]> {
  const out: T[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  const res = await Promise.all(chunks.map(run));
  for (const r of res) out.push(...(r.data ?? []));
  return out;
}

async function myAccountIds(c: Ctx): Promise<string[]> {
  const { data } = await c.sb.from("account").select("id").eq("tenant_id", c.tenantId).eq("owner_user_id", c.s.userId).limit(2000);
  return (data ?? []).map((a) => a.id);
}

// --- Contacts ------------------------------------------------------------------------------------------

export type ContactSP = { q?: string; scope?: string; role?: string; show?: string; sort?: string };

export type ContactListRow = {
  id: string;
  name: string;
  title: string | null;
  persona_role: string;
  account_id: string | null;
  account_name: string | null;
  last_touch_at: string | null;
  days: number | null;
  phone: string | null;
  email: string | null;
  bounced: boolean;
  quiet: boolean;
  dupe: boolean;
  do_not_contact: boolean;
};

export async function loadContacts(c: Ctx, sp: ContactSP): Promise<{ rows: ContactListRow[]; error: string | null; capped: boolean }> {
  const { sb, tenantId } = c;
  const term = cleanQuery(sp.q);
  let q = sb
    .from("contact")
    .select("id,full_name,title,persona_role,account_id,last_touch_at,phone,mobile,email,email_status,do_not_contact")
    .eq("tenant_id", tenantId)
    .is("duplicate_of", null)
    .eq("is_test", false);
  let mine: Set<string> | null = null;
  if (sp.scope !== "all") {
    const ids = await myAccountIds(c);
    if (ids.length === 0) return { rows: [], error: null, capped: false };
    if (ids.length <= 150) q = q.in("account_id", ids);
    else mine = new Set(ids);
  }
  if (term) q = q.or(`full_name.ilike.%${term}%,email.ilike.%${term}%,title.ilike.%${term}%,phone.ilike.%${term}%,mobile.ilike.%${term}%${phoneDigitsClause(term)}`);
  if (sp.role && sp.role in PERSONA_ROLES) q = q.eq("persona_role", sp.role);
  if (sp.show === "never") q = q.is("last_touch_at", null);
  if (sp.show === "email") q = q.not("email", "is", null);
  if (sp.show === "phone") q = q.or("phone.not.is.null,mobile.not.is.null");
  if (sp.show === "bounced") q = q.eq("email_status", "bounced");
  if (sp.show === "quiet") q = q.lt("last_touch_at", new Date(Date.now() - 14 * 86_400_000).toISOString());
  q = sp.sort === "name" ? q.order("full_name", { nullsFirst: false }) : q.order("last_touch_at", { ascending: false, nullsFirst: false }).order("full_name");
  const { data, error } = await q.limit(400);
  if (error) return { rows: [], error: error.message, capped: false };

  let rows = (data ?? []).filter((r) => !mine || (r.account_id && mine.has(r.account_id)));
  const acctIds = [...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))];
  const accts = await inChunks(acctIds, (ch) => sb.from("account").select("id,name,icp_tier").in("id", ch));
  const am = new Map(accts.map((a) => [a.id, a]));
  const now = new Date();
  if (sp.show === "quiet") rows = rows.filter((r) => isGoingQuiet(r.last_touch_at, r.account_id ? am.get(r.account_id)?.icp_tier : 3, now));

  // Possible duplicates: same email or same name anywhere in the tenant (cheap, page-scoped lookup).
  const page = rows.slice(0, 150);
  const emails = [...new Set(page.map((r) => r.email).filter((x): x is string => !!x))];
  const names = [...new Set(page.map((r) => r.full_name).filter((x): x is string => !!x))];
  const others = [
    ...(await inChunks(emails, (ch) => sb.from("contact").select("id,full_name,email,phone,mobile,account_id").eq("tenant_id", tenantId).is("duplicate_of", null).in("email", ch), 50)),
    ...(await inChunks(names, (ch) => sb.from("contact").select("id,full_name,email,phone,mobile,account_id").eq("tenant_id", tenantId).is("duplicate_of", null).in("full_name", ch), 50)),
  ];
  const pool = new Map([...page, ...others].map((x) => [x.id, { id: x.id, full_name: x.full_name, email: x.email, phone: x.phone, mobile: x.mobile, account_id: x.account_id }]));
  const dupeIds = new Set(duplicateGroups([...pool.values()]).flat().map((x) => x.id));

  return {
    capped: rows.length > 150,
    error: null,
    rows: page.map((r) => ({
      id: r.id,
      name: r.full_name ?? r.email ?? "Unnamed contact",
      title: r.title,
      persona_role: r.persona_role,
      account_id: r.account_id,
      account_name: r.account_id ? am.get(r.account_id)?.name ?? null : null,
      last_touch_at: r.last_touch_at,
      days: daysSince(r.last_touch_at, now),
      phone: r.mobile ?? r.phone,
      email: r.email,
      bounced: r.email_status === "bounced",
      quiet: isGoingQuiet(r.last_touch_at, r.account_id ? am.get(r.account_id)?.icp_tier : 3, now),
      dupe: dupeIds.has(r.id),
      do_not_contact: r.do_not_contact,
    })),
  };
}

// --- Properties ----------------------------------------------------------------------------------------

export type PropertySP = {
  q?: string;
  scope?: string;
  city?: string;
  market?: string;
  asset?: string;
  roof?: string;
  age?: string;
  warranty?: string;
  opp?: string;
  noacct?: string;
  incomplete?: string;
  stale?: string;
  /** "damage" = any leak/damage flag (DAMAGE_FLAGS), "leak" = active leak only. */
  cond?: string;
  /** Management company changed in the last 90 days. */
  newmgmt?: string;
  /** Storm-type signal at the building or its market in the last 30 days (property_current.storm_kind). */
  storm?: string;
  /** No touch ever logged at the building. */
  never?: string;
  sort?: string;
  /** "lat,lng" from the phone when sort=near (Properties → Nearby). */
  near?: string;
  /** View-only (never saved in a list): Properties tab (active | lists | all) and multi-select mode. */
  tab?: string;
  select?: string;
};

/** Where loadProperties reads from: the whole book (default), one static list, or a set of buildings. */
export type PropertySource = {
  /** Static list: rows come from list_property_current in list order unless a sort is picked. */
  listId?: string;
  /** Only these buildings (My active). */
  ids?: string[];
  /** Skip the city / market chip counts (lists, working list). */
  facets?: boolean;
  /** Rows returned (default 150; `total` still counts every match). */
  max?: number;
};

export type PropertyListRow = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  account_id: string | null;
  account_name: string | null;
  roof_system: string | null;
  roof_install_year: number | null;
  roof_area_sf: number | null;
  warranty_expires_on: string | null;
  open_value: number;
  open_count: number;
  last_touch_at: string | null;
  days: number | null;
  incomplete: boolean;
  manager_name?: string | null;
  owner_name?: string | null;
  badges?: PropertyBadge[];
  /** Straight-line miles from the rep (sort=near). */
  distance_mi?: number | null;
  state?: string | null;
  lat?: number | null;
  lng?: number | null;
  active_flags?: string[];
};

/** "30.2672,-97.7431" → coordinates, or null. */
export function parseNear(near: string | undefined): { lat: number; lng: number } | null {
  const m = near?.match(/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
/** ~50 miles: the prefilter box for Nearby (then exact distance + sort in memory). */
const NEAR_BOX_DEG = 0.75;

export async function loadProperties(
  c: Pick<Ctx, "sb" | "tenantId" | "today"> & { s: { userId: string } },
  sp: PropertySP,
  src: PropertySource = {},
): Promise<{
  rows: PropertyListRow[];
  error: string | null;
  capped: boolean;
  total?: number;
  cities: { city: string; n: number }[];
  markets: { slug: string; name: string; n: number }[];
}> {
  const { sb, tenantId, today } = c;
  const year = Number(today.slice(0, 4));
  const term = cleanQuery(sp.q);
  const preset = sp.stale === "1";
  const cols =
    "id,name,address1,city,state,account_id,roof_system,roof_install_year,roof_area_sf,warranty_expires_on,current_manager_name,current_owner_name,active_flags,open_service_lines,management_changed_on,ownership_changed_on,storm_kind,storm_at,lat,lng";
  const fromBook = () => sb.from("property_current").select(cols);
  // list_property_current = list_item ⋈ property_current: same columns, so the same filters apply.
  let q = (src.listId ? (sb.from("list_property_current").select(cols).eq("list_id", src.listId) as unknown as ReturnType<typeof fromBook>) : fromBook())
    .eq("tenant_id", tenantId)
    .is("duplicate_of", null)
    .eq("is_test", false);
  if (src.ids) q = q.in("id", src.ids.length ? src.ids.slice(0, 300) : ["00000000-0000-0000-0000-000000000000"]);
  let mine: Set<string> | null = null;
  if (sp.scope === "mine") {
    const ids = await myAccountIds(c as Ctx);
    if (ids.length <= 150) q = q.in("account_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    else mine = new Set(ids);
  }
  if (term) q = q.or(`name.ilike.%${term}%,address1.ilike.%${term}%,city.ilike.%${term}%`);
  if (sp.city) q = q.ilike("city", cleanQuery(sp.city));
  // Tenant markets (tiny): awaited up front only when a market filter is picked, otherwise alongside the list.
  const marketsP = (async () => {
    const tm = await sb.from("tenant_market").select("market_id").eq("tenant_id", tenantId);
    const ids = (tm.data ?? []).map((m) => m.market_id);
    return ids.length ? ((await sb.from("market").select("id,slug,name").in("id", ids)).data ?? []) : [];
  })();
  if (sp.market) {
    const picked = (await marketsP).find((m) => m.slug === sp.market);
    if (picked) q = q.eq("market_id", picked.id);
  }
  if (sp.asset) q = q.ilike("asset_class", cleanQuery(sp.asset));
  if (sp.roof) q = q.ilike("roof_system", cleanQuery(sp.roof));
  const band = sp.age as AgeBand | undefined;
  if (band === "unknown") q = q.is("roof_install_year", null);
  else if (band === "lt10" || band === "10to15" || band === "15to20" || band === "20plus") {
    const { min, max } = ageBandYears(band, year);
    if (min != null) q = q.gte("roof_install_year", min);
    if (max != null) q = q.lte("roof_install_year", max);
  }
  if (preset) q = q.not("roof_install_year", "is", null);
  if (sp.warranty === "1") q = q.gte("warranty_expires_on", today).lte("warranty_expires_on", addDays(today, 365));
  if (sp.noacct === "1") q = q.is("account_id", null);
  if (sp.incomplete === "1") q = q.or("roof_system.is.null,address1.is.null,roof_area_sf.is.null");
  if (sp.cond === "damage") q = q.overlaps("active_flags", [...DAMAGE_FLAGS]);
  if (sp.cond === "leak") q = q.contains("active_flags", ["active_leak"]);
  if (sp.newmgmt === "1") q = q.gte("management_changed_on", addDays(today, -90));
  if (sp.storm === "1") q = q.not("storm_kind", "is", null);

  const here = sp.sort === "near" ? parseNear(sp.near) : null;
  const sort = preset ? "age" : here ? "near" : sp.sort === "near" ? "recent" : sp.sort ?? "recent";
  if (here) {
    const lngBox = NEAR_BOX_DEG / Math.max(0.2, Math.cos((here.lat * Math.PI) / 180));
    q = q
      .gte("lat", here.lat - NEAR_BOX_DEG)
      .lte("lat", here.lat + NEAR_BOX_DEG)
      .gte("lng", here.lng - lngBox)
      .lte("lng", here.lng + lngBox);
  }
  const listOrder = !!src.listId && !sp.sort && !preset && !here;
  q =
    sort === "age"
      ? q.order("roof_install_year", { ascending: true, nullsFirst: false })
      : listOrder
        ? (q.order("list_position" as "name") as typeof q)
        : q.order("name", { nullsFirst: false });
  const facets = src.facets !== false;
  const [{ data, error }, cityRows, marketRows] = await Promise.all([
    q.limit(src.listId ? 2000 : 500),
    facets ? sb.from("property").select("city,market_id").eq("tenant_id", tenantId).is("duplicate_of", null).limit(5000) : Promise.resolve({ data: [] as { city: string | null; market_id: string | null }[] }),
    facets ? marketsP : Promise.resolve([] as { id: string; slug: string; name: string }[]),
  ]);
  if (error) return { rows: [], error: error.message, capped: false, cities: [], markets: [] };

  const counts = new Map<string, number>();
  const perMarket = new Map<string, number>();
  for (const r of cityRows.data ?? []) {
    if (r.city) counts.set(r.city, (counts.get(r.city) ?? 0) + 1);
    if (r.market_id) perMarket.set(r.market_id, (perMarket.get(r.market_id) ?? 0) + 1);
  }
  const markets = marketRows
    .map((m) => ({ slug: m.slug, name: m.name, n: perMarket.get(m.id) ?? 0 }))
    .filter((m) => m.n > 0)
    .sort((a, b) => b.n - a.n);
  const cities = [...counts.entries()]
    .map(([city, n]) => ({ city, n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 8);

  let rows = (data ?? []).flatMap((r) => (r.id && (!mine || (r.account_id && mine.has(r.account_id))) ? [{ ...r, id: r.id }] : []));
  const ids = rows.map((r) => r.id);
  const [touches, opps, accts] = await Promise.all([
    inChunks(ids, (ch) => sb.from("touch").select("property_id,occurred_at").eq("tenant_id", tenantId).in("property_id", ch).is("voided_at", null).order("occurred_at", { ascending: false }).limit(2000)),
    inChunks(ids, (ch) =>
      sb.from("opportunity").select("property_id,value_estimate").eq("tenant_id", tenantId).in("property_id", ch).not("stage", "in", "(won,lost)"),
    ),
    inChunks([...new Set(rows.map((r) => r.account_id).filter((x): x is string => !!x))], (ch) => sb.from("account").select("id,name").in("id", ch)),
  ]);
  const last = new Map<string, string>();
  for (const t of touches) if (t.property_id && !last.has(t.property_id)) last.set(t.property_id, t.occurred_at);
  const oppVal = new Map<string, { v: number; n: number }>();
  for (const o of opps) {
    if (!o.property_id) continue;
    const cur = oppVal.get(o.property_id) ?? { v: 0, n: 0 };
    oppVal.set(o.property_id, { v: cur.v + Number(o.value_estimate ?? 0), n: cur.n + 1 });
  }
  const an = new Map(accts.map((a) => [a.id, a.name]));
  const now = new Date();

  if (sp.opp === "1") rows = rows.filter((r) => oppVal.has(r.id));
  if (preset) rows = rows.filter((r) => {
    const d = daysSince(last.get(r.id), now);
    return d == null || d > 60;
  });
  if (sp.never === "1") rows = rows.filter((r) => !last.has(r.id));
  if (sort === "recent" && !listOrder) {
    rows = [...rows].sort((a, b) => (last.get(b.id) ?? "").localeCompare(last.get(a.id) ?? ""));
  }
  const dist = new Map<string, number>();
  if (here) {
    for (const r of rows) if (r.lat != null && r.lng != null) dist.set(r.id, haversineMiles(here, { lat: Number(r.lat), lng: Number(r.lng) }));
    rows = [...rows].sort((a, b) => (dist.get(a.id) ?? 1e9) - (dist.get(b.id) ?? 1e9));
  }

  return {
    cities,
    markets,
    error: null,
    capped: rows.length > (src.max ?? 150),
    total: rows.length,
    rows: rows.slice(0, src.max ?? 150).map((r) => ({
      id: r.id,
      name: r.name || r.address1 || "Unnamed property",
      address: r.address1,
      city: r.city,
      account_id: r.account_id,
      account_name: r.account_id ? an.get(r.account_id) ?? null : null,
      roof_system: r.roof_system,
      roof_install_year: r.roof_install_year,
      roof_area_sf: r.roof_area_sf == null ? null : Number(r.roof_area_sf),
      warranty_expires_on: r.warranty_expires_on,
      open_value: oppVal.get(r.id)?.v ?? 0,
      open_count: oppVal.get(r.id)?.n ?? 0,
      last_touch_at: last.get(r.id) ?? null,
      days: daysSince(last.get(r.id), now),
      incomplete: !r.roof_system || !r.address1 || r.roof_area_sf == null,
      manager_name: r.current_manager_name,
      owner_name: r.current_owner_name,
      badges: propertyBadges(r, today),
      distance_mi: dist.get(r.id) ?? null,
      state: r.state,
      lat: r.lat == null ? null : Number(r.lat),
      lng: r.lng == null ? null : Number(r.lng),
      active_flags: r.active_flags ?? [],
    })),
  };
}
