// Smart-list filters are the Properties list URL params, stored as jsonb on public.list.filter.
// Pure: shared by the properties list ("Save as list"), the list page, the working list and tests.

/** Every Properties-list param a smart list may carry (order = canonical URL order). */
export const LIST_FILTER_KEYS = [
  "q",
  "scope",
  "market",
  "city",
  "asset",
  "roof",
  "age",
  "stale",
  "warranty",
  "cond",
  "newmgmt",
  "storm",
  "never",
  "opp",
  "noacct",
  "incomplete",
  "sort",
] as const;
export type ListFilterKey = (typeof LIST_FILTER_KEYS)[number];
export type ListFilter = Partial<Record<ListFilterKey, string>>;

/** Params that switch a condition on with "1". */
const TOGGLES: ListFilterKey[] = ["stale", "warranty", "newmgmt", "storm", "never", "opp", "noacct", "incomplete"];
const ENUMS: Partial<Record<ListFilterKey, readonly string[]>> = {
  scope: ["mine"],
  age: ["lt10", "10to15", "15to20", "20plus", "unknown"],
  cond: ["damage", "leak"],
  sort: ["age", "name", "recent"],
};

/**
 * Keep only known params with sane values. Drops view-only params (tab, list, select, near — "near" is a phone
 * location, not part of a saved list) and anything empty or oversized.
 */
export function cleanFilter(sp: Record<string, string | string[] | undefined | null>): ListFilter {
  const out: ListFilter = {};
  for (const k of LIST_FILTER_KEYS) {
    const raw = sp[k];
    const v = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!v || v.length > 80) continue;
    if (TOGGLES.includes(k)) {
      if (v === "1") out[k] = "1";
      continue;
    }
    const allowed = ENUMS[k];
    if (allowed && !allowed.includes(v)) continue;
    if (k === "sort" && v === "recent") continue; // the default
    out[k] = v;
  }
  return out;
}

export function isEmptyFilter(f: ListFilter): boolean {
  return Object.keys(cleanFilter(f)).length === 0;
}

/** Filter → canonical query string (no leading "?"), stable key order. */
export function filterToSearch(f: ListFilter, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  const clean = cleanFilter(f);
  for (const k of LIST_FILTER_KEYS) if (clean[k]) p.set(k, clean[k]!);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** The Properties list (All tab — a rep's default may be My active) showing exactly this filter. */
export function filterHref(f: ListFilter): string {
  return `/app/properties?${filterToSearch(f, { tab: "all" })}`;
}

const AGE: Record<string, string> = { lt10: "Under 10 yrs", "10to15": "10–15 yrs", "15to20": "15–20 yrs", "20plus": "20+ yrs", unknown: "Age unknown" };
const LABELS: Partial<Record<ListFilterKey, string>> = {
  stale: "Oldest roofs · quiet 60d",
  warranty: "Warranty ends < 12 mo",
  newmgmt: "New management (90d)",
  storm: "Storm hit (30d)",
  never: "Never touched",
  opp: "Open opportunity",
  noacct: "No account",
  incomplete: "Missing data",
};

/** Short human summary, e.g. ["Mine", "Memphis", "TPO", "20+ yrs", "Never touched"]. */
export function describeFilter(f: ListFilter, markets: { slug: string; name: string }[] = []): string[] {
  const c = cleanFilter(f);
  const out: string[] = [];
  if (c.q) out.push(`“${c.q}”`);
  if (c.scope === "mine") out.push("Mine");
  if (c.market) out.push(markets.find((m) => m.slug === c.market)?.name ?? c.market);
  if (c.city) out.push(c.city);
  if (c.asset) out.push(c.asset[0]!.toUpperCase() + c.asset.slice(1));
  if (c.roof) out.push(c.roof);
  if (c.age) out.push(AGE[c.age] ?? c.age);
  if (c.cond) out.push(c.cond === "leak" ? "Active leak" : "Leaks & damage");
  for (const k of TOGGLES) if (c[k]) out.push(LABELS[k]!);
  if (c.sort === "age") out.push("Oldest roof first");
  if (c.sort === "name") out.push("By name");
  return out;
}

/** Damage/condition flags behind cond=damage ("Open leaks & damage"). cond=leak is the leak alone. */
export const DAMAGE_FLAGS = [
  "active_leak",
  "hail_damage",
  "wind_damage",
  "ponding",
  "membrane_damage",
  "flashing_issue",
  "drainage_issue",
  "safety_hazard",
] as const;

export type SystemListDef = { key: string; name: string; filter: ListFilter };

/** Seeded for every company by app.seed_system_lists (20261004500000_lists_pursuit_admin.sql) — keep in step. */
export const SYSTEM_LISTS: SystemListDef[] = [
  { key: "oldest_quiet", name: "Oldest roofs · quiet 60 days", filter: { stale: "1" } },
  { key: "warranty_12mo", name: "Warranty ending in 12 months", filter: { warranty: "1" } },
  { key: "leaks_damage", name: "Open leaks & damage", filter: { cond: "damage" } },
  { key: "new_mgmt_90", name: "New management (90 days)", filter: { newmgmt: "1" } },
  { key: "never_touched", name: "Never touched", filter: { never: "1" } },
  { key: "storm_30", name: "Storm hit (30 days)", filter: { storm: "1" } },
];

/** jsonb from the database → filter (unknown keys and junk dropped). */
export function parseStoredFilter(raw: unknown): ListFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === "string") o[k] = v;
  return cleanFilter(o);
}
