// Photon (https://photon.komoot.io) — free, OSM-based, no key. Server-side only; the browser never calls it.
import { MAX_SUGGESTIONS, joinLabel, round6, stateCode, usZip, type AddressSuggestion, type LatLngBias } from "./types";

export const PHOTON_ENDPOINT = "https://photon.komoot.io/api/";

export function photonUrl(q: string, near: LatLngBias | null): string {
  // Ask for a few extra: non-US hits are dropped before we keep six.
  const p = new URLSearchParams({ q, limit: "10", lang: "en" });
  if (near) {
    p.set("lat", near.lat.toFixed(4));
    p.set("lon", near.lng.toFixed(4));
  }
  return `${PHOTON_ENDPOINT}?${p.toString()}`;
}

type PhotonFeature = {
  geometry?: { coordinates?: unknown[] };
  properties?: Record<string, unknown>;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * GeoJSON FeatureCollection → US suggestions with a street. A pin is only attached when there's a house number
 * (a street-only hit's coordinates are the middle of the street — the Census batch geocoder does better).
 */
export function mapPhoton(body: unknown): AddressSuggestion[] {
  const features = (body as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: AddressSuggestion[] = [];
  const seen = new Set<string>();
  for (const f of features as PhotonFeature[]) {
    const p = f?.properties ?? {};
    if (String(p.countrycode ?? "").toUpperCase() !== "US") continue;
    const street = str(p.street) ?? (p.osm_key === "highway" ? str(p.name) : null);
    if (!street) continue;
    const house = str(p.housenumber);
    const address1 = house ? `${house} ${street}` : street;
    const city = str(p.city) ?? str(p.town) ?? str(p.village) ?? str(p.locality) ?? str(p.district);
    const state = stateCode(str(p.state));
    const zip = usZip(str(p.postcode));
    const [lon, lat] = Array.isArray(f.geometry?.coordinates) ? f.geometry!.coordinates!.map(Number) : [NaN, NaN];
    const pinned = !!house && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    const base = joinLabel(address1, city, state, zip);
    const name = str(p.name);
    const label = name && name !== street && name !== address1 && house ? `${name} · ${base}` : base;
    const key = base.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `photon:${String(p.osm_type ?? "")}${String(p.osm_id ?? out.length)}`,
      label,
      address1,
      city,
      state,
      zip,
      lat: pinned ? round6(lat) : null,
      lng: pinned ? round6(lon) : null,
      provider: "photon",
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

export function photonUserAgent(): string {
  const site = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://dillyos.com";
  return `Dilly/1.0 (roofing BD app; address suggestions; +${site})`;
}

export async function photonSuggest(
  q: string,
  near: LatLngBias | null,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<AddressSuggestion[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(photonUrl(q, near), {
    headers: { Accept: "application/json", "User-Agent": photonUserAgent() },
    signal: opts.signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`photon http_${res.status}`);
  return mapPhoton(await res.json());
}
