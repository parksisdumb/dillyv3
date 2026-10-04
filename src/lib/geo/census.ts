// US Census Geocoder (free, no key, US addresses). Server-side only — the browser never calls it (CSP stays 'self').
// https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=…

export const CENSUS_ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";

export type GeocodeOutcome = { status: "ok"; lat: number; lng: number; matched: string | null } | { status: "nomatch" } | { status: "error"; error: string };

/** "123 Main St, Austin, TX 78701" — null when there isn't enough to find a building (street + city/state or zip). */
export function oneLineAddress(p: { address1: string | null; city: string | null; state: string | null; zip: string | null }): string | null {
  const street = p.address1?.trim();
  if (!street || !/\d/.test(street)) return null; // "Riverside campus" can't be geocoded to a door
  const cityState = [p.city?.trim(), [p.state?.trim(), p.zip?.trim()].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (!cityState) return null;
  return `${street}, ${cityState}`;
}

export function censusUrl(address: string): string {
  const q = new URLSearchParams({ benchmark: "Public_AR_Current", format: "json", address });
  return `${CENSUS_ENDPOINT}?${q.toString()}`;
}

/** First address match → coordinates (Census returns x = longitude, y = latitude). */
export function parseCensus(body: unknown): GeocodeOutcome {
  const matches = (body as { result?: { addressMatches?: unknown[] } })?.result?.addressMatches;
  if (!Array.isArray(matches)) return { status: "error", error: "unexpected response" };
  const m = matches[0] as { coordinates?: { x?: unknown; y?: unknown }; matchedAddress?: unknown } | undefined;
  if (!m) return { status: "nomatch" };
  const lng = Number(m.coordinates?.x);
  const lat = Number(m.coordinates?.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { status: "error", error: "bad coordinates" };
  return { status: "ok", lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, matched: typeof m.matchedAddress === "string" ? m.matchedAddress : null };
}

export async function geocodeAddress(address: string, opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<GeocodeOutcome> {
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await f(censusUrl(address), { signal: ctrl.signal, headers: { Accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { status: "error", error: `http_${res.status}` };
    return parseCensus(await res.json());
  } catch (e) {
    return { status: "error", error: (e as Error)?.name === "AbortError" ? "timeout" : String((e as Error)?.message ?? e).slice(0, 200) };
  } finally {
    clearTimeout(t);
  }
}

/** Space requests so we stay at ≤ `perSecond` against the Census API. */
export function rateLimiter(perSecond: number, now: () => number = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
  const gap = 1000 / perSecond;
  let next = 0;
  return async () => {
    const t = now();
    const wait = Math.max(0, next - t);
    next = Math.max(t, next) + gap;
    if (wait > 0) await sleep(wait);
  };
}
