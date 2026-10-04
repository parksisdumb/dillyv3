import Link from "next/link";
import type { PickOption } from "@/lib/actions/book";
import { roofAge } from "@/lib/domain/book";
import { daysBetween, mapsUrl, quietLabel, shortDate } from "@/lib/format";
import { Empty, PageHeader, SectionTitle } from "@/components/ui/bits";
import { btn, cn } from "@/components/ui/styles";
import { LogContext } from "@/components/log/log-provider";
import { LogButton } from "@/components/log/log-button";
import { TouchTimeline, type TimelineTouch } from "@/components/accounts/touch-timeline";
import { PropertyForm } from "@/components/accounts/forms";
import { LinkedList, OpenTasks, Opportunities, type LinkLite, type OppLite, type TaskLite } from "@/components/accounts/related";
import { IconDirections, IconEdit } from "@/components/icons";
import { DETAIL_FLAGS, propertyBadges, type PropertyBadgeInput } from "@/lib/domain/badges-property";
import { PropertyBadges } from "@/components/accounts/property-badges";
import { ConditionToggles } from "@/components/accounts/condition-toggles";
import { OwnershipSection, type OwnershipData, type TransferPreview } from "@/components/accounts/ownership";

export type PropertyDetailData = {
  today: string;
  year: number;
  p: {
    id: string;
    account_id: string | null;
    name: string | null;
    address1: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    asset_class: string | null;
    roof_system: string | null;
    roof_area_sf: number | null;
    roof_install_year: number | null;
    warranty_expires_on: string | null;
    building_count: number | null;
    notes: string | null;
  };
  account: PickOption | null;
  contacts: LinkLite[];
  tasks: TaskLite[];
  opps: OppLite[];
  timeline: TimelineTouch[];
  lastTouchAt: string | null;
  /** property_current columns that drive badges (flags, open job types, storm, management change). */
  badge: Omit<PropertyBadgeInput, "roof_system" | "roof_install_year" | "warranty_expires_on">;
  ownership: OwnershipData;
};

function Fact({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "warn" | "bad" | "muted" }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface-2 px-3 py-2">
      <div className="label text-xs text-muted">{label}</div>
      <div className={cn("num truncate font-display text-xl font-bold", tone === "warn" && "text-warning", tone === "bad" && "text-danger", tone === "muted" && "text-muted")}>{value}</div>
      {sub && <div className="truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function PropertyDetailView({ d, preview }: { d: PropertyDetailData; preview?: TransferPreview }) {
  const { p, today } = d;
  const age = roofAge(p.roof_install_year, d.year);
  const warrantyDays = p.warranty_expires_on ? daysBetween(today, p.warranty_expires_on) : null;
  const hasFacts = !!(p.roof_system || p.roof_area_sf || p.roof_install_year || p.warranty_expires_on || p.building_count);
  const directions = mapsUrl([p.address1, p.city, p.state]);
  const lastDays = d.lastTouchAt ? daysBetween(d.lastTouchAt.slice(0, 10), today) : null;
  const badges = propertyBadges({ ...d.badge, roof_system: p.roof_system, roof_install_year: p.roof_install_year, warranty_expires_on: p.warranty_expires_on }, today);

  return (
    <div>
      <LogContext propertyId={p.id} accountId={p.account_id} />
      <PageHeader back="/app/properties" title={p.name || p.address1 || "Property"} sub={[p.address1, p.city, p.state].filter(Boolean).join(", ") || "No address yet"} />
      <div className="px-4 text-sm">
        {d.account ? (
          <Link href={`/app/accounts/${d.account.id}`} className="inline-flex min-h-12 items-center font-semibold underline decoration-line underline-offset-2">
            {d.account.label}
          </Link>
        ) : (
          <span className="inline-flex min-h-12 items-center text-warning">No owner or manager linked</span>
        )}
        <span className="text-muted"> · {quietLabel(lastDays, d.lastTouchAt)}</span>
      </div>
      <PropertyBadges badges={badges} className="px-4 pb-2" />
      <div className="flex gap-2 px-4 pt-1">
        <LogButton target={{ propertyId: p.id, accountId: p.account_id }} variant="primary" className="flex-1" label="Log at this building" />
        {directions && (
          <a href={directions} target="_blank" rel="noreferrer" className={btn("secondary", "md")}>
            <IconDirections size={20} /> Directions
          </a>
        )}
      </div>

      <section className="px-4 pt-3" aria-label="Condition">
        <div className="label pb-1.5 text-xs text-muted">Condition · tap to flag</div>
        <ConditionToggles propertyId={p.id} active={d.badge.active_flags ?? []} flags={DETAIL_FLAGS} collapsed={5} />
      </section>

      <OwnershipSection d={d.ownership} preview={preview} />

      <SectionTitle
        action={
          <a href="#edit" className="label inline-flex min-h-12 items-center gap-1 px-2 text-xs text-accent">
            <IconEdit size={16} /> Edit
          </a>
        }
      >
        Roof
      </SectionTitle>
      {hasFacts ? (
        <div className="grid grid-cols-2 gap-2 px-4 sm:grid-cols-3">
          <Fact label="System" value={p.roof_system ?? "—"} tone={p.roof_system ? undefined : "muted"} sub={p.asset_class ?? undefined} />
          <Fact
            label="Age"
            value={age != null ? `${age} yrs` : "—"}
            sub={p.roof_install_year ? `Installed ${p.roof_install_year}` : "Install year unknown"}
            tone={age == null ? "muted" : age >= 20 ? "bad" : age >= 15 ? "warn" : undefined}
          />
          <Fact label="Area" value={p.roof_area_sf ? `${Math.round(p.roof_area_sf).toLocaleString()} sf` : "—"} tone={p.roof_area_sf ? undefined : "muted"} />
          <Fact
            label="Warranty"
            value={p.warranty_expires_on ? (warrantyDays! < 0 ? "Expired" : shortDate(p.warranty_expires_on)) : "—"}
            sub={
              p.warranty_expires_on
                ? warrantyDays! < 0
                  ? `Ended ${shortDate(p.warranty_expires_on)}`
                  : warrantyDays! <= 365
                    ? `Ends in ${Math.max(1, Math.round(warrantyDays! / 30))} mo`
                    : p.warranty_expires_on.slice(0, 4)
                : "Unknown"
            }
            tone={p.warranty_expires_on ? (warrantyDays! < 0 ? "bad" : warrantyDays! <= 365 ? "warn" : undefined) : "muted"}
          />
          <Fact label="Buildings" value={p.building_count ?? "—"} tone={p.building_count ? undefined : "muted"} />
        </div>
      ) : (
        <a href="#edit" className="mx-4 flex min-h-16 items-center gap-3 rounded-lg border-2 border-dashed border-accent bg-surface px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block font-display text-base font-bold">Add roof facts</span>
            <span className="block text-sm text-muted">System, size, install year, warranty. Roof age is what ranks re-roof and repair work.</span>
          </span>
          <IconEdit className="text-accent" />
        </a>
      )}

      <OpenTasks tasks={d.tasks} today={today} />
      <Opportunities opps={d.opps} today={today} newHref={`/app/pipeline/new?property=${p.id}${p.account_id ? `&account=${p.account_id}` : ""}`} />
      <LinkedList kind="contacts" selfId={p.id} links={d.contacts} />

      <SectionTitle>Timeline</SectionTitle>
      {d.timeline.length === 0 ? <Empty title="No touches here yet" /> : <TouchTimeline touches={d.timeline} />}

      <SectionTitle>Building & roof details</SectionTitle>
      <div id="edit" className="scroll-mt-16">
        <PropertyForm p={p} />
      </div>
    </div>
  );
}
