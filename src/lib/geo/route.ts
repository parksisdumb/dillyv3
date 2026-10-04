// Route for the day (pure; unit-tested): straight-line distances, nearest-neighbour ordering and Google Maps
// multi-stop directions URLs that open the Maps app on iPhone and Android with no API key.

export type LatLng = { lat: number; lng: number };
export type RouteStop = { id: string; label: string; address: string | null; lat: number | null; lng: number | null };

const R_MILES = 3958.8;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const hasCoords = (s: { lat: number | null; lng: number | null }): s is { lat: number; lng: number } =>
  typeof s.lat === "number" && typeof s.lng === "number" && Number.isFinite(s.lat) && Number.isFinite(s.lng);

/**
 * Greedy nearest-neighbour from `origin` (the rep's location), or from the first stop when there's no origin.
 * Stops without coordinates keep their relative order at the end (they still go in the Maps URL by address).
 */
export function nearestNeighborOrder<T extends RouteStop>(stops: T[], origin: LatLng | null): T[] {
  const located = stops.filter(hasCoords);
  const unlocated = stops.filter((s) => !hasCoords(s));
  if (located.length === 0) return [...unlocated];
  const left = [...located];
  const out: T[] = [];
  let here: LatLng;
  if (origin) here = origin;
  else {
    // "From the first stop": the first located stop in the current order starts the route.
    const first = left.shift()!;
    out.push(first);
    here = first as LatLng;
  }
  while (left.length) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = haversineMiles(here, left[i] as LatLng);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
      }
    }
    const [next] = left.splice(best, 1);
    out.push(next);
    here = next as LatLng;
  }
  return [...out, ...unlocated];
}

/** Miles from each stop's predecessor (origin for the first); null when either end has no coordinates. */
export function legDistances(stops: RouteStop[], origin: LatLng | null): (number | null)[] {
  return stops.map((s, i) => {
    const prev: LatLng | RouteStop | null = i === 0 ? origin : stops[i - 1];
    return prev && hasCoords(prev) && hasCoords(s) ? haversineMiles(prev, s) : null;
  });
}

export function formatMiles(mi: number | null): string {
  if (mi == null) return "";
  if (mi < 0.1) return "< 0.1 mi";
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/** What Google Maps should search for: the street address when we have one (reads well in Maps), else lat,lng. */
export function mapsPoint(s: RouteStop | LatLng): string {
  if ("address" in s && s.address) return s.address;
  if (hasCoords(s as RouteStop)) return `${(s as LatLng).lat.toFixed(6)},${(s as LatLng).lng.toFixed(6)}`;
  return "label" in s ? s.label : "";
}

/** Google Maps allows up to 9 waypoints between origin and destination in a directions URL. */
export const MAX_WAYPOINTS = 9;

export type MapsLeg = { url: string; from: number; to: number };

/**
 * https://www.google.com/maps/dir/?api=1&origin=…&destination=…&waypoints=a|b|c&travelmode=driving
 * With more stops than one URL holds, split into legs; each leg starts where the previous one ended.
 * `from`/`to` are 1-based stop numbers covered by the leg (for button labels).
 */
export function mapsDirectionsUrls(stops: RouteStop[], origin: LatLng | null): MapsLeg[] {
  const points = stops.map(mapsPoint).filter(Boolean);
  if (points.length === 0) return [];
  const legs: MapsLeg[] = [];
  // With a rep location the first leg starts there; otherwise at stop 1.
  let start: string = origin ? `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}` : points[0];
  let i = origin ? 0 : 1; // index of the first stop this leg still has to reach
  let firstStop = 1;
  if (!origin && points.length === 1) {
    return [{ url: buildUrl(null, points[0], []), from: 1, to: 1 }];
  }
  while (i < points.length) {
    const take = Math.min(points.length - i, MAX_WAYPOINTS + 1); // waypoints + destination
    const chunk = points.slice(i, i + take);
    const destination = chunk[chunk.length - 1];
    const waypoints = chunk.slice(0, -1);
    legs.push({ url: buildUrl(start, destination, waypoints), from: firstStop, to: i + take });
    start = destination;
    firstStop = i + take;
    i += take;
  }
  return legs;
}

function buildUrl(origin: string | null, destination: string, waypoints: string[]): string {
  const q = new URLSearchParams({ api: "1" });
  if (origin) q.set("origin", origin);
  q.set("destination", destination);
  if (waypoints.length) q.set("waypoints", waypoints.join("|"));
  q.set("travelmode", "driving");
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}
