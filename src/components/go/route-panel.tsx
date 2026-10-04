"use client";
import { useEffect, useMemo, useState } from "react";
import { currentPosition } from "@/lib/images/downscale";
import { formatMiles, hasCoords, legDistances, mapsDirectionsUrls, routeWithFixedFirst, type LatLng, type RouteStop } from "@/lib/geo/route";
import { btn, cn } from "@/components/ui/styles";
import { IconDirections, IconNearMe } from "@/components/icons";

/**
 * Today's stops in driving order: nearest-neighbour from where the rep is (if they allow location) or from the
 * first stop, straight-line miles between stops, and Google Maps multi-stop directions (no API key; opens the Maps
 * app on iPhone/Android). More than 10 stops → split into legs.
 */
export function RoutePanel({
  stops,
  onUseOrder,
  fixedCount = 0,
}: {
  stops: RouteStop[];
  onUseOrder: (ids: string[]) => void;
  /** The first N stops are appointments: they keep their time order and go first; the rest are routed after them. */
  fixedCount?: number;
}) {
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(true);
  const [denied, setDenied] = useState(false);

  const locate = () => {
    setLocating(true);
    void currentPosition().then((p) => {
      setOrigin(p);
      setDenied(!p);
      setLocating(false);
    });
  };
  useEffect(() => {
    let live = true;
    void currentPosition().then((p) => {
      if (!live) return;
      setOrigin(p);
      setDenied(!p);
      setLocating(false);
    });
    return () => {
      live = false;
    };
  }, []);

  const ordered = useMemo(() => routeWithFixedFirst(stops.slice(0, fixedCount), stops.slice(fixedCount), origin), [stops, origin, fixedCount]);
  const dist = useMemo(() => legDistances(ordered, origin), [ordered, origin]);
  const legs = useMemo(() => mapsDirectionsUrls(ordered, origin), [ordered, origin]);
  const total = dist.reduce<number>((n, d) => n + (d ?? 0), 0);
  const unpinned = ordered.filter((s) => !hasCoords(s)).length;

  return (
    <div className="flex flex-col gap-3 px-4 pb-4 pt-3" data-testid="route-panel">
      <div className="flex items-start gap-2 text-sm">
        <IconNearMe size={18} className="mt-0.5 shrink-0 text-accent" />
        <p className="min-w-0 flex-1 text-muted">
          {locating ? "Finding you…" : origin ? "Starting from where you are." : denied ? "Starting at the first stop. Allow location to start from where you are." : "Starting at the first stop."}
        </p>
        {!locating && !origin && (
          <button type="button" onClick={locate} className="label shrink-0 text-xs text-accent">
            Use my location
          </button>
        )}
      </div>

      <ol className="divide-y divide-line rounded-lg border-2 border-line bg-surface" aria-label="Stops in route order">
        {ordered.map((s, i) => (
          <li key={s.id} className="flex min-h-14 items-center gap-3 px-3 py-2">
            <span className="num w-6 shrink-0 font-display text-lg font-bold">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {i < fixedCount && <span className="label mr-1.5 text-xs text-accent">Appt</span>}
                {s.label}
              </span>
              <span className="block truncate text-sm text-muted">{s.address ?? "No address"}</span>
            </span>
            <span className={cn("num shrink-0 text-right text-sm", hasCoords(s) ? "text-ink" : "label text-xs text-warning")}>
              {hasCoords(s) ? formatMiles(dist[i]) : "No pin yet"}
            </span>
          </li>
        ))}
      </ol>
      <p className="num text-sm text-muted">
        {ordered.length} stops{total > 0 && <> · about {formatMiles(total)} straight-line</>}
        {unpinned > 0 && <> · {unpinned} without a map pin go last</>}
      </p>

      {legs.map((l, i) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          data-testid="maps-route"
          className={btn(i === 0 ? "primary" : "secondary", "lg", "w-full")}
        >
          <IconDirections size={22} />
          {legs.length === 1 ? "Open route in Google Maps" : `Google Maps · stops ${l.from}–${l.to}`}
        </a>
      ))}
      <button type="button" onClick={() => onUseOrder(ordered.map((s) => s.id))} className={btn("secondary", "md", "w-full")}>
        Go through stops in this order
      </button>
    </div>
  );
}
