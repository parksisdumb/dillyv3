// Address suggestions while typing (property / account forms). Pure types + helpers, safe on server and client.

export type SuggestProvider = "google" | "photon";

/**
 * One suggestion. Photon (and the e2e fake) return every field up front. Google returns the label + a place id first
 * (`needsDetails`); the fields and coordinates arrive from one Place Details call after the rep picks it.
 */
export type AddressSuggestion = {
  id: string;
  label: string;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  provider: SuggestProvider;
  needsDetails?: boolean;
};

export type LatLngBias = { lat: number; lng: number };

export const MIN_QUERY = 3;
export const MAX_SUGGESTIONS = 6;
export const MAX_QUERY = 200;

/** "35.1,-90.0" → {lat,lng}; null when malformed or out of range. */
export function parseNear(raw: string | null | undefined): LatLngBias | null {
  if (!raw) return null;
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(raw);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validLatLng(lat, lng) ? { lat, lng } : null;
}

export function validLatLng(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE",
  nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "puerto rico": "PR", guam: "GU",
  "u.s. virgin islands": "VI", "united states virgin islands": "VI", "american samoa": "AS", "northern mariana islands": "MP",
};
const CODES = new Set(Object.values(STATES));

/** "Tennessee" / "TN" / "tn" → "TN"; anything else → the trimmed input (never invents a code). */
export function stateCode(s: string | null | undefined): string | null {
  const t = s?.trim();
  if (!t) return null;
  if (t.length === 2 && CODES.has(t.toUpperCase())) return t.toUpperCase();
  return STATES[t.toLowerCase()] ?? t;
}

/** "38104-1234" → "38104-1234"; "38104" → "38104"; junk → null. */
export function usZip(z: string | null | undefined): string | null {
  const m = /^\s*(\d{5})(?:[-\s]?(\d{4}))?\s*$/.exec(z ?? "");
  return m ? (m[2] ? `${m[1]}-${m[2]}` : m[1]) : null;
}

export function joinLabel(address1: string | null, city: string | null, state: string | null, zip: string | null): string {
  return [address1, city, [state, zip].filter(Boolean).join(" ")].filter((x) => x && String(x).trim()).join(", ");
}
