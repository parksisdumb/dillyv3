import Link from "next/link";
import { AGE_BANDS, roofAge } from "@/lib/domain/book";
import { daysBetween, money, shortDate } from "@/lib/format";
import type { PropertyListRow, PropertySP } from "@/lib/server/book";
import { BookTabs } from "@/components/accounts/book-tabs";
import { FilterChip, hrefWith } from "@/components/accounts/filter-chip";
import { Chip, Empty, ErrorNote } from "@/components/ui/bits";
import { btn, cn, input } from "@/components/ui/styles";
import { IconPlus, IconSearch } from "@/components/icons";
import { PropertyBadges } from "@/components/accounts/property-badges";
import { NearbySort } from "@/components/accounts/nearby-sort";
import { formatMiles } from "@/lib/geo/route";
import { PropertyTabs, type PropertyTab } from "@/components/lists/property-tabs";
import { PursuitToggle } from "@/components/lists/pursuit-toggle";
import { BulkBar, BulkCheck } from "@/components/lists/bulk-bar";
import { SaveAsListButton, type ListOption } from "@/components/lists/list-sheets";
import { cleanFilter, describeFilter, isEmptyFilter } from "@/lib/lists/filter";

/** "4d ago", "3mo ago", "Never touched" — the list row's freshness, kept short so badges get the room. */
function quietShort(days: number | null): string {
  if (days == null) return "Never touched";
  if (days < 1) return "Today";
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
}

const ROOF_SYSTEMS = ["TPO", "EPDM", "PVC", "Mod-bit", "BUR", "Metal", "Shingle", "Coating"];
const ASSET_CLASSES = ["Multifamily", "Office", "Industrial", "Retail", "K-12", "Healthcare", "Hospitality", "Government"];
const TOGGLES: { k: keyof PropertySP; label: string; on?: string }[] = [
  { k: "cond", label: "Leaks & damage", on: "damage" },
  { k: "warranty", label: "Warranty ends < 12 mo" },
  { k: "newmgmt", label: "New mgmt 90d" },
  { k: "storm", label: "Storm hit 30d" },
  { k: "never", label: "Never touched" },
  { k: "opp", label: "Open opportunity" },
  { k: "noacct", label: "No account" },
  { k: "incomplete", label: "Missing data" },
];

export function PropertiesListView({
  sp,
  rows,
  cities,
  markets = [],
  today,
  error,
  capped,
  headerExtra,
  tab = "all",
  activeCount = 0,
  activeIds,
  lists = [],
  isManager = false,
  listsPanel,
}: {
  tab?: PropertyTab;
  activeCount?: number;
  /** Buildings I'm actively pursuing (row toggles). */
  activeIds?: Set<string>;
  /** Static lists I can add to (multi-select → Add to list). */
  lists?: ListOption[];
  isManager?: boolean;
  /** Lists tab body (rendered instead of rows). */
  listsPanel?: React.ReactNode;
  sp: PropertySP;
  rows: PropertyListRow[];
  cities: { city: string; n: number }[];
  markets?: { slug: string; name: string; n: number }[];
  today: string;
  error?: string | null;
  capped?: boolean;
  headerExtra?: React.ReactNode;
}) {
  const base = "/app/properties";
  const year = Number(today.slice(0, 4));
  const preset = sp.stale === "1";
  const sort = preset ? "age" : sp.sort ?? "recent";
  const scope = sp.scope === "mine" ? "mine" : "all";
  const selecting = sp.select === "1";
  return (
    <div>
      <BookTabs active="properties" />
      <PropertyTabs tab={tab} activeCount={activeCount} />
      {tab === "lists" ? (
        listsPanel
      ) : (
      <>
      {headerExtra}
      <form method="get" action={base} className="mt-3 flex flex-col gap-2 px-4">
        {Object.entries(sp).map(([k, v]) => (!["q", "asset", "roof", "age", "select"].includes(k) && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search properties</span>
            <IconSearch size={20} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Search properties" className={`${input} pl-10`} type="search" autoComplete="off" />
          </label>
          <Link href="/app/properties/new" className={btn("secondary", "md", "shrink-0")}>
            <IconPlus size={18} /> Property
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <select name="roof" defaultValue={sp.roof ?? ""} className={cn(input, "px-2")} aria-label="Roof system">
            <option value="">Roof</option>
            {ROOF_SYSTEMS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select name="age" defaultValue={sp.age ?? ""} className={cn(input, "px-2")} aria-label="Roof age">
            <option value="">Age</option>
            {Object.entries(AGE_BANDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select name="asset" defaultValue={sp.asset ?? ""} className={cn(input, "px-2")} aria-label="Asset class">
            <option value="">Asset</option>
            {ASSET_CLASSES.map((a) => (
              <option key={a} value={a.toLowerCase()}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={btn("primary", "md")}>
          Search
        </button>
      </form>

      <div className="mt-3 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Quick filters">
        <FilterChip tone="accent" href={preset ? hrefWith(base, sp, { stale: undefined }) : hrefWith(base, {}, { stale: "1", scope: sp.scope, tab: sp.tab })} active={preset}>
          Oldest roofs · quiet 60d
        </FilterChip>
        <FilterChip href={hrefWith(base, sp, { scope: scope === "mine" ? undefined : "mine" })} active={scope === "mine"}>
          Mine
        </FilterChip>
        {TOGGLES.map((t) => (
          <FilterChip key={t.k} href={hrefWith(base, sp, { [t.k]: sp[t.k] === (t.on ?? "1") ? undefined : t.on ?? "1" })} active={sp[t.k] === (t.on ?? "1")}>
            {t.label}
          </FilterChip>
        ))}
      </div>
      {(markets.length > 1 || (sp.market && markets.length > 0)) && (
        <div className="mt-2 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Market">
          <FilterChip href={hrefWith(base, sp, { market: undefined })} active={!sp.market}>
            All markets
          </FilterChip>
          {markets.map((m) => (
            <FilterChip key={m.slug} href={hrefWith(base, sp, { market: m.slug })} active={sp.market === m.slug}>
              {m.name} <span className="num ml-1 opacity-70">{m.n}</span>
            </FilterChip>
          ))}
        </div>
      )}
      {cities.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="City">
          <FilterChip href={hrefWith(base, sp, { city: undefined })} active={!sp.city}>
            All cities
          </FilterChip>
          {cities.map((c) => (
            <FilterChip key={c.city} href={hrefWith(base, sp, { city: c.city })} active={sp.city === c.city}>
              {c.city} <span className="num ml-1 opacity-70">{c.n}</span>
            </FilterChip>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between px-4 pt-1 text-sm text-muted">
        <span className="num">
          {rows.length}
          {capped ? "+" : ""} {tab === "active" ? "active" : "properties"}
        </span>
        {!preset && (
          <span>
            Sort:{" "}
            {(
              [
                ["recent", "Last touch"],
                ["age", "Oldest roof"],
                ["name", "Name"],
              ] as const
            ).map(([k, l], i) => (
              <span key={k}>
                {i > 0 && "·"}
                <Link className={cn("inline-flex min-h-12 items-center px-1", sort === k && "font-semibold text-ink")} href={hrefWith(base, sp, { sort: k === "recent" ? undefined : k, near: undefined })}>
                  {l}
                </Link>
              </span>
            ))}
            ·
            <NearbySort base={base} sp={sp} active={sort === "near"} />
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pb-2">
        {tab === "all" && !isEmptyFilter(cleanFilter(sp)) && (
          <SaveAsListButton filter={cleanFilter(sp)} summary={describeFilter(cleanFilter(sp), markets)} isManager={isManager} count={rows.length} />
        )}
        {rows.length > 0 &&
          (selecting ? (
            <Link href={hrefWith(base, sp, { select: undefined })} className={btn("secondary", "sm")}>
              Done
            </Link>
          ) : (
            <Link href={hrefWith(base, sp, { select: "1" })} className={btn("secondary", "sm")}>
              Select
            </Link>
          ))}
      </div>

      {error && <ErrorNote>Couldn&apos;t load properties: {error}</ErrorNote>}
      {!error && rows.length === 0 &&
        (tab === "active" ? (
          <Empty title="Nothing active yet">Tap Active on a property you&apos;re working — it leads your Go list until you drop it.</Empty>
        ) : (
          <Empty title="No properties match">Clear a filter, or add one with + Property.</Empty>
        ))}
      {rows.length > 0 && (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {rows.map((r) => {
            const age = roofAge(r.roof_install_year, year);
            const wDays = r.warranty_expires_on ? daysBetween(today, r.warranty_expires_on) : null;
            return (
              <li key={r.id} className="flex items-start gap-1 pr-3 hover:bg-surface-2">
                <Link href={`/app/properties/${r.id}`} className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-display text-base font-bold">{r.name}</span>
                      {r.distance_mi != null && <span className="num shrink-0 text-xs font-semibold">{formatMiles(r.distance_mi)}</span>}
                      <span className={cn("num shrink-0 text-xs", r.days == null || r.days > 60 ? "text-warning" : "text-muted")}>{quietShort(r.days)}</span>
                      {r.open_value > 0 && <span className="num shrink-0 font-display font-bold">{money(r.open_value)}</span>}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {[r.address !== r.name ? r.address : null, r.city].filter(Boolean).join(", ")}
                      {" · "}
                      {r.manager_name ?? r.account_name ?? <span className="text-warning">No account</span>}
                      {r.owner_name && r.owner_name !== (r.manager_name ?? r.account_name) && <> · Owner {r.owner_name}</>}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {r.badges ? (
                        <PropertyBadges badges={r.badges} max={3} className="min-w-0 flex-1" />
                      ) : (
                        <span className="num flex flex-1 flex-wrap items-center gap-x-3 text-sm">
                          {r.roof_system ? <span className="label text-xs">{r.roof_system}</span> : <span className="text-muted">Roof unknown</span>}
                          {age != null && <span className={cn("font-semibold", age >= 20 ? "text-danger" : age >= 15 ? "text-warning" : "text-ink")}>{age} yrs</span>}
                          {wDays != null && wDays >= 0 && wDays <= 365 && <Chip tone="warn">Warranty ends {shortDate(r.warranty_expires_on)}</Chip>}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="pt-2">
                  {selecting ? <BulkCheck id={r.id} name={r.name} /> : <PursuitToggle propertyId={r.id} name={r.name} active={!!activeIds?.has(r.id)} compact />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {capped && <p className="px-4 py-3 text-sm text-muted">Showing 150. Search or filter to narrow.</p>}
      {selecting && rows.length > 0 && <BulkBar lists={lists} doneHref={hrefWith(base, sp, { select: undefined })} />}
      </>
      )}
    </div>
  );
}
