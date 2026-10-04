"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { DayStop } from "@/components/go/types";
import { RoutePanel } from "@/components/go/route-panel";
import { TodayAppointments, type MyAppointments } from "@/components/appointments/today-appointments";
import { LogButton } from "@/components/log/log-button";
import { HideLogFab } from "@/components/log/log-provider";
import { PropertyBadges } from "@/components/accounts/property-badges";
import { ConditionToggles } from "@/components/accounts/condition-toggles";
import { FIELD_FLAGS } from "@/lib/domain/badges-property";
import { PERSONA_ROLES, type PersonaRole } from "@/lib/domain/vocab";
import { Sheet } from "@/components/ui/sheet";
import { TierPill } from "@/components/ui/bits";
import { useToast } from "@/components/ui/toast";
import { btn, cn } from "@/components/ui/styles";
import { IconCheck, IconChevronDown, IconDirections, IconPhone, IconRoute } from "@/components/icons";
import type { RouteStop } from "@/lib/geo/route";


/**
 * Go = "My day": (a) today's appointments in time order (each expands into its buildings), (b) my working list —
 * one tap to log at any stop (the normal Log sheet picks in-person / call / email), (c) Route: appointment stops first,
 * then the list. Calls are a button on the list, not a mode.
 */
export function MyDay({
  appointments,
  stops: initial,
  listTitle,
  listHint,
  callHref,
  initialRoute = false,
}: {
  appointments: MyAppointments;
  stops: DayStop[];
  listTitle: string;
  listHint?: string | null;
  callHref?: string | null;
  /** Dev preview: open with the Route sheet up. */
  initialRoute?: boolean;
}) {
  const { toast } = useToast();
  // The server's stops are the source of truth (a log refreshes them: "Logged today"); Route only overrides the order.
  const [order, setOrder] = useState<string[] | null>(null);
  const stops = useMemo(() => {
    if (!order) return initial;
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...initial].sort((a, b) => (rank.get(a.key) ?? order.length) - (rank.get(b.key) ?? order.length));
  }, [initial, order]);
  const [route, setRoute] = useState(initialRoute);
  const [open, setOpen] = useState<string | null>(null);

  // Appointment stops (today, in time order; a series = each building) go first in the route.
  const apptStops: RouteStop[] = useMemo(
    () =>
      appointments.today.flatMap((a) =>
        a.stops.length
          ? a.stops.map((s) => ({ id: `appt:${a.id}:${s.propertyId}`, label: `${a.timeLabel} · ${s.name}`, address: s.address, lat: s.lat, lng: s.lng }))
          : a.location
            ? [{ id: `appt:${a.id}`, label: `${a.timeLabel} · ${a.title}`, address: a.location, lat: null, lng: null }]
            : [],
      ),
    [appointments],
  );
  const listStops: RouteStop[] = stops.map((s) => ({
    id: s.key,
    label: s.place && s.place !== s.accountName ? `${s.accountName} · ${s.place}` : s.accountName,
    address: s.mapsAddress ?? ([s.address, s.city].filter(Boolean).join(", ") || null),
    lat: s.lat ?? null,
    lng: s.lng ?? null,
  }));
  const logged = stops.filter((s) => s.logged).length;

  return (
    <div>
      {/* Every stop has its own Log button; the floating one would cover them. */}
      <HideLogFab />
      <TodayAppointments d={appointments} expandable />

      <section aria-label={listTitle} data-testid="working-list">
        <div className="flex min-h-12 items-center justify-between gap-2 px-4 pt-5">
          <h2 className="label min-w-0 truncate text-sm text-muted">
            {listTitle}
            {stops.length > 0 && ` · ${logged ? `${logged}/` : ""}${stops.length}`}
          </h2>
          {(stops.length > 0 || apptStops.length > 0) && (
            <button type="button" onClick={() => setRoute(true)} className={btn("ghost", "sm", "shrink-0")}>
              <IconRoute size={18} /> Route
            </button>
          )}
        </div>
        {listHint && <p className="px-4 pb-2 text-sm text-muted">{listHint}</p>}
        {stops.length === 0 ? (
          <div className="mx-4 rounded-lg border-2 border-dashed border-line px-4 py-6 text-center">
            <p className="font-display text-xl font-bold">No stops on your list</p>
            <p className="mt-1 text-sm text-muted">Mark buildings Active or ask your manager for a list. Accounts assigned to you with an address show up here too.</p>
            <Link href="/app/properties" className={btn("primary", "md", "mt-4")}>
              Find buildings
            </Link>
          </div>
        ) : (
          <ol className="divide-y divide-line border-y border-line bg-surface" aria-label="Stops">
            {stops.map((s, i) => {
              const expanded = open === s.key;
              return (
                <li key={s.key} className="px-4 py-3" data-testid="stop" aria-label={`Stop ${i + 1}: ${s.place ?? s.accountName}`}>
                  <div className="flex items-start gap-3">
                    <span className="num w-6 shrink-0 pt-0.5 font-display text-lg font-bold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <TierPill tier={s.tier} />
                        <Link
                          href={s.propertyId ? `/app/properties/${s.propertyId}` : `/app/accounts/${s.accountId}`}
                          className="min-w-0 flex-1 font-display text-base font-bold leading-snug"
                        >
                          {s.place ?? s.accountName}
                        </Link>
                      </div>
                      {s.place && s.accountName && s.accountName !== s.place && <div className="truncate text-sm">{s.accountName}</div>}
                      <div className="truncate text-sm text-muted">{[s.address, s.city].filter(Boolean).join(", ")}</div>
                      {s.reason && <div className="text-sm">{s.reason}</div>}
                      {s.logged && (
                        <div className="label mt-0.5 flex items-center gap-1 text-xs text-success">
                          <IconCheck size={14} /> Logged today · {s.logged}
                        </div>
                      )}
                      {s.badges && s.badges.length > 0 && <PropertyBadges badges={s.badges} max={3} className="mt-1.5" />}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 pl-9">
                    {s.directions ? (
                      <a href={s.directions} target="_blank" rel="noreferrer" className={btn("secondary", "md", "w-12 shrink-0 px-0")} aria-label={`Directions to ${s.place ?? s.accountName}`}>
                        <IconDirections size={20} className="shrink-0" />
                      </a>
                    ) : null}
                    <LogButton
                      target={{ propertyId: s.propertyId, accountId: s.accountId || null }}
                      variant={s.logged ? "secondary" : "accent-outline"}
                      className="flex-1"
                      ariaLabel={`Log at ${s.place ?? s.accountName}`}
                    />
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`More for ${s.place ?? s.accountName}`}
                      onClick={() => setOpen(expanded ? null : s.key)}
                      className={btn("secondary", "md", "w-12 shrink-0 px-0")}
                    >
                      <IconChevronDown size={20} className={cn("motion-safe:transition-transform", expanded && "rotate-180")} />
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-3 flex flex-col gap-3 pl-9">
                      {s.propertyId && (
                        <div>
                          <div className="label text-xs text-muted">Seen on the roof</div>
                          <ConditionToggles propertyId={s.propertyId} active={s.flags ?? []} flags={FIELD_FLAGS} className="mt-1.5" label="Flag a condition" />
                        </div>
                      )}
                      {s.contacts.length > 0 && (
                        <div>
                          <div className="label text-xs text-muted">Log with</div>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {s.contacts.slice(0, 6).map((p) => (
                              <LogButton
                                key={p.id}
                                target={{ propertyId: s.propertyId, accountId: s.accountId || null, contactId: p.id }}
                                label={p.name}
                                size="sm"
                                ariaLabel={`Log with ${p.name} (${p.title ?? PERSONA_ROLES[p.role as PersonaRole] ?? "contact"})`}
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {callHref && stops.length > 0 && (
          <div className="px-4 pt-3">
            <Link href={callHref} className={btn("secondary", "md", "w-full")}>
              <IconPhone size={20} className="shrink-0" /> Call through this list
            </Link>
          </div>
        )}
      </section>

      <Sheet open={route} onClose={() => setRoute(false)} title="Route for today" labelledBy="route-sheet">
        {route && (
          <RoutePanel
            stops={[...apptStops, ...listStops]}
            fixedCount={apptStops.length}
            onUseOrder={(ids) => {
              const keys = new Set(stops.map((s) => s.key));
              setOrder(ids.filter((id) => keys.has(id)));
              setRoute(false);
              toast("Stops reordered for the drive", "neutral");
            }}
          />
        )}
      </Sheet>
    </div>
  );
}
