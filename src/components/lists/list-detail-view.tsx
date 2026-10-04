import Link from "next/link";
import type { PropertyListRow } from "@/lib/server/book";
import type { ListFilter } from "@/lib/lists/filter";
import { filterHref } from "@/lib/lists/filter";
import { updateList } from "@/lib/actions/lists";
import { formatMiles } from "@/lib/geo/route";
import { Bar, Chip, Empty, ErrorNote, PageHeader } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { PropertyBadges } from "@/components/accounts/property-badges";
import { NearbySort } from "@/components/accounts/nearby-sort";
import { hrefWith } from "@/components/accounts/filter-chip";
import { PursuitToggle } from "@/components/lists/pursuit-toggle";
import { BulkBar, BulkCheck } from "@/components/lists/bulk-bar";
import { AssignListButton, type RepOption } from "@/components/lists/list-sheets";
import { RunButton } from "@/components/ui/run-button";
import { IconDownload, IconPhone } from "@/components/icons";

export type ListSort = "list" | "near" | "age" | "untouched";

export type ListDetailData = {
  list: {
    id: string;
    name: string;
    description: string | null;
    kind: "static" | "smart";
    createdFrom: string;
    filter: ListFilter;
    visibility: "private" | "team";
    archived: boolean;
  };
  summary: string[];
  rows: PropertyListRow[];
  total: number;
  capped: boolean;
  error: string | null;
  progress: { touched: number; total: number };
  today: string;
  sort: ListSort;
  selecting: boolean;
  canEdit: boolean;
  isManager: boolean;
  activeIds: string[];
  assigned: string[];
  assignedNames: string[];
  members: RepOption[];
};

function quiet(days: number | null): string {
  if (days == null) return "Never touched";
  if (days < 1) return "Today";
  if (days < 60) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function ListDetailView({ d }: { d: ListDetailData }) {
  const { list } = d;
  const base = `/app/lists/${list.id}`;
  const sp: Record<string, string | undefined> = { sort: d.sort === "list" ? undefined : d.sort };
  const active = new Set(d.activeIds);
  const pct = d.progress.total ? Math.round((d.progress.touched / d.progress.total) * 100) : 0;
  const sorts: [ListSort, string][] = [
    ["list", list.kind === "static" ? "List order" : "Default"],
    ["untouched", "Untouched first"],
    ["age", "Oldest roof"],
  ];
  return (
    <div>
      <PageHeader
        back="/app/properties?tab=lists"
        title={list.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <Chip tone={list.kind === "smart" ? "accent" : "neutral"}>{list.kind === "smart" ? "Updates itself" : "Hand-picked"}</Chip>
            {list.createdFrom === "system" && <Chip>Built-in</Chip>}
            {list.visibility === "team" ? <span>Team</span> : <span>Private</span>}
            {list.archived && <Chip tone="warn">Archived</Chip>}
          </span>
        }
      />
      {list.description && <p className="px-4 text-sm text-muted">{list.description}</p>}
      {list.kind === "smart" && d.summary.length > 0 && (
        <p className="px-4 pt-1 text-sm">
          <span className="text-muted">Filter: </span>
          <Link href={filterHref(list.filter)} className="font-semibold underline decoration-line underline-offset-2">
            {d.summary.join(" · ")}
          </Link>
        </p>
      )}
      {d.assignedNames.length > 0 && <p className="px-4 pt-1 text-sm text-muted">Assigned to {d.assignedNames.join(", ")}</p>}

      <section aria-label="Progress" className="mx-4 mt-3 rounded-lg border-2 border-line bg-surface p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="num font-display text-lg font-bold" data-testid="list-progress">
            {d.progress.touched} of {d.progress.total} touched in the last 30 days
          </p>
          <span className="num text-sm text-muted">{pct}%</span>
        </div>
        <div className="mt-2">
          <Bar value={d.progress.touched} max={Math.max(d.progress.total, 1)} tone={pct >= 75 ? "success" : "accent"} />
        </div>
      </section>

      <div className="flex flex-wrap gap-2 px-4 pt-3">
        <Link href={`/app/go?list=${list.id}&mode=calls`} className={btn("primary", "md", "flex-1")}>
          <IconPhone size={18} /> Call through this list
        </Link>
        {d.isManager && <AssignListButton listId={list.id} members={d.members} assigned={d.assigned} />}
      </div>
      <div className="flex flex-wrap items-center gap-1 px-4 pt-2">
        <a href={`${base}/export`} className={btn("ghost", "sm")} download>
          <IconDownload size={16} /> Export CSV
        </a>
        {d.rows.length > 0 &&
          (d.selecting ? (
            <Link href={hrefWith(base, sp, {})} className={btn("ghost", "sm")}>
              Done
            </Link>
          ) : (
            <Link href={hrefWith(base, sp, { select: "1" })} className={btn("ghost", "sm")}>
              Select
            </Link>
          ))}
        {d.canEdit && list.createdFrom !== "system" && (
          <RunButton
            action={updateList.bind(null, { listId: list.id, archived: !list.archived })}
            label={list.archived ? "Restore" : "Archive"}
            variant="ghost"
            size="sm"
            confirm={list.archived ? undefined : "Archive this list? It leaves everyone's Lists tab and Go."}
            then={list.archived ? undefined : "/app/properties?tab=lists"}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-2 px-4 pt-1 text-sm text-muted">
        <span className="num">
          {d.total}
          {d.capped ? "+" : ""} {d.total === 1 ? "property" : "properties"}
        </span>
        <span>
          {sorts.map(([k, l], i) => (
            <span key={k}>
              {i > 0 && "·"}
              <Link
                className={cn("inline-flex min-h-12 items-center px-1", d.sort === k && "font-semibold text-ink")}
                aria-current={d.sort === k ? "true" : undefined}
                href={hrefWith(base, {}, { sort: k === "list" ? undefined : k })}
              >
                {l}
              </Link>
            </span>
          ))}
          ·
          <NearbySort base={base} sp={{}} active={d.sort === "near"} />
        </span>
      </div>

      {d.error && <ErrorNote>Couldn&apos;t load this list: {d.error}</ErrorNote>}
      {!d.error && d.rows.length === 0 && (
        <Empty title={list.kind === "smart" ? "Nothing matches right now" : "This list is empty"}>
          {list.kind === "smart" ? "Buildings join as they match the filter." : "Add properties from the Properties list: Select → Add to list."}
        </Empty>
      )}
      {d.rows.length > 0 && (
        <ul className="divide-y divide-line border-y border-line bg-surface" aria-label="List properties">
          {d.rows.map((r) => (
            <li key={r.id} className="flex items-start gap-1 pr-3 hover:bg-surface-2">
              <Link href={`/app/properties/${r.id}`} className="flex min-w-0 flex-1 flex-col py-3 pl-4">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-display text-base font-bold">{r.name}</span>
                  {r.distance_mi != null && <span className="num shrink-0 text-xs font-semibold">{formatMiles(r.distance_mi)}</span>}
                  <span className={cn("num shrink-0 text-xs", r.days == null || r.days > 30 ? "text-warning" : "text-muted")}>{quiet(r.days)}</span>
                </span>
                <span className="truncate text-sm text-muted">
                  {[r.address !== r.name ? r.address : null, r.city].filter(Boolean).join(", ")}
                  {" · "}
                  {r.manager_name ?? r.account_name ?? <span className="text-warning">No account</span>}
                </span>
                {r.badges && <PropertyBadges badges={r.badges} max={3} className="mt-1.5" />}
              </Link>
              <div className="pt-2">{d.selecting ? <BulkCheck id={r.id} name={r.name} /> : <PursuitToggle propertyId={r.id} name={r.name} active={active.has(r.id)} compact />}</div>
            </li>
          ))}
        </ul>
      )}
      {d.capped && <p className="px-4 py-3 text-sm text-muted">Showing the first {d.rows.length}. Export for the whole list.</p>}
      {d.selecting && d.rows.length > 0 && <BulkBar lists={[]} listId={d.canEdit && list.kind === "static" ? list.id : undefined} doneHref={hrefWith(base, sp, {})} />}
    </div>
  );
}
