import Link from "next/link";
import { AGE_BANDS, roofAge } from "@/lib/domain/book";
import { daysBetween, money, quietLabel, shortDate } from "@/lib/format";
import type { PropertyListRow, PropertySP } from "@/lib/server/book";
import { BookTabs } from "@/components/accounts/book-tabs";
import { FilterChip, hrefWith } from "@/components/accounts/filter-chip";
import { Chip, Empty, ErrorNote } from "@/components/ui/bits";
import { btn, cn, input } from "@/components/ui/styles";
import { IconChevronRight, IconPlus, IconSearch } from "@/components/icons";

const ROOF_SYSTEMS = ["TPO", "EPDM", "PVC", "Mod-bit", "BUR", "Metal", "Shingle", "Coating"];
const ASSET_CLASSES = ["Multifamily", "Office", "Industrial", "Retail", "K-12", "Healthcare", "Hospitality", "Government"];
const TOGGLES: { k: keyof PropertySP; label: string }[] = [
  { k: "warranty", label: "Warranty ends < 12 mo" },
  { k: "opp", label: "Open opportunity" },
  { k: "noacct", label: "No account" },
  { k: "incomplete", label: "Missing data" },
];

export function PropertiesListView({
  sp,
  rows,
  cities,
  today,
  error,
  capped,
}: {
  sp: PropertySP;
  rows: PropertyListRow[];
  cities: { city: string; n: number }[];
  today: string;
  error?: string | null;
  capped?: boolean;
}) {
  const base = "/app/properties";
  const year = Number(today.slice(0, 4));
  const preset = sp.stale === "1";
  const sort = preset ? "age" : sp.sort ?? "recent";
  const scope = sp.scope === "mine" ? "mine" : "all";
  return (
    <div>
      <BookTabs active="properties" />
      <form method="get" action={base} className="mt-3 flex flex-col gap-2 px-4">
        {Object.entries(sp).map(([k, v]) => (!["q", "asset", "roof", "age"].includes(k) && v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
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
        <FilterChip tone="accent" href={preset ? hrefWith(base, sp, { stale: undefined }) : hrefWith(base, {}, { stale: "1", scope: sp.scope })} active={preset}>
          Oldest roofs · quiet 60d
        </FilterChip>
        <FilterChip href={hrefWith(base, sp, { scope: scope === "mine" ? undefined : "mine" })} active={scope === "mine"}>
          Mine
        </FilterChip>
        {TOGGLES.map((t) => (
          <FilterChip key={t.k} href={hrefWith(base, sp, { [t.k]: sp[t.k] === "1" ? undefined : "1" })} active={sp[t.k] === "1"}>
            {t.label}
          </FilterChip>
        ))}
      </div>
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
          {capped ? "+" : ""} properties
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
                <Link className={cn("inline-flex min-h-12 items-center px-1", sort === k && "font-semibold text-ink")} href={hrefWith(base, sp, { sort: k === "recent" ? undefined : k })}>
                  {l}
                </Link>
              </span>
            ))}
          </span>
        )}
      </div>

      {error && <ErrorNote>Couldn&apos;t load properties: {error}</ErrorNote>}
      {!error && rows.length === 0 && <Empty title="No properties match">Clear a filter, or add one with + Property.</Empty>}
      {rows.length > 0 && (
        <ul className="divide-y divide-line border-y border-line bg-surface">
          {rows.map((r) => {
            const age = roofAge(r.roof_install_year, year);
            const wDays = r.warranty_expires_on ? daysBetween(today, r.warranty_expires_on) : null;
            return (
              <li key={r.id}>
                <Link href={`/app/properties/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate font-display text-base font-bold">{r.name}</span>
                      {r.open_value > 0 && <span className="num shrink-0 font-display font-bold">{money(r.open_value)}</span>}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {[r.address !== r.name ? r.address : null, r.city].filter(Boolean).join(", ")}
                      {" · "}
                      {r.account_name ?? <span className="text-warning">No account</span>}
                    </div>
                    <div className="num mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {r.roof_system ? <span className="label text-xs">{r.roof_system}</span> : <span className="text-muted">Roof unknown</span>}
                      {age != null && <span className={cn("font-semibold", age >= 20 ? "text-danger" : age >= 15 ? "text-warning" : "text-ink")}>{age} yrs</span>}
                      {wDays != null && wDays >= 0 && wDays <= 365 && <Chip tone="warn">Warranty ends {shortDate(r.warranty_expires_on)}</Chip>}
                      {wDays != null && wDays < 0 && <span className="text-muted">Out of warranty</span>}
                      <span className={cn(r.days == null || r.days > 60 ? "text-warning" : "text-muted")}>{quietLabel(r.days, r.last_touch_at)}</span>
                    </div>
                  </div>
                  <IconChevronRight size={20} className="mt-1 shrink-0 text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {capped && <p className="px-4 py-3 text-sm text-muted">Showing 150. Search or filter to narrow.</p>}
    </div>
  );
}
