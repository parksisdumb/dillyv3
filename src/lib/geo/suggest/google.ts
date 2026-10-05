// Google Places API (New): Autocomplete while typing, then one Place Details call for the pick.
// Server-side only (the key never reaches the browser). The same session token goes on every Autocomplete request of
// a typing session and on the Details call that ends it, so Google bills the whole thing as one session.
import { MAX_SUGGESTIONS, round6, stateCode, usZip, validLatLng, type AddressSuggestion, type LatLngBias } from "./types";

export const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
export const DETAILS_URL = "https://places.googleapis.com/v1/places/";
export const DETAILS_FIELD_MASK = "id,formattedAddress,addressComponents,location";
/** Places (New) caps a circle bias at 50 km. */
const BIAS_RADIUS_M = 50_000;

/** Google: "URL and filename safe base64 string with at most 36 ASCII characters" (a UUID fits). */
export const SESSION_TOKEN_RE = /^[A-Za-z0-9_-]{8,36}$/;
export const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;

export function autocompleteBody(q: string, near: LatLngBias | null, sessionToken: string | null) {
  return {
    input: q,
    includedRegionCodes: ["us"],
    regionCode: "us",
    languageCode: "en",
    ...(sessionToken ? { sessionToken } : {}),
    ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: BIAS_RADIUS_M } } } : {}),
  };
}

type Prediction = {
  placeId?: string;
  text?: { text?: string };
  structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
};

/** "Memphis, TN, USA" / "Memphis, TN" / "" → true; "Toronto, ON, Canada" → false. */
export function looksUS(secondary: string): boolean {
  const parts = secondary.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return true;
  const last = parts[parts.length - 1];
  return /^(USA|US|United States)$/i.test(last) || /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(last);
}

/** Autocomplete response → label-only suggestions (fields come from Details). Non-US secondary text is dropped. */
export function mapAutocomplete(body: unknown): AddressSuggestion[] {
  const list = (body as { suggestions?: unknown })?.suggestions;
  if (!Array.isArray(list)) return [];
  const out: AddressSuggestion[] = [];
  for (const s of list as { placePrediction?: Prediction }[]) {
    const p = s?.placePrediction;
    if (!p?.placeId || !PLACE_ID_RE.test(p.placeId)) continue;
    const main = p.structuredFormat?.mainText?.text?.trim() || null;
    const secondary = p.structuredFormat?.secondaryText?.text?.trim() || "";
    // includedRegionCodes already limits to the US; this catches anything that slips through ("…, Canada").
    if (!looksUS(secondary)) continue;
    const label = (p.text?.text?.trim() || [main, secondary].filter(Boolean).join(", ")).replace(/,\s*(USA|United States)$/i, "");
    if (!label) continue;
    out.push({
      id: `google:${p.placeId}`,
      label,
      address1: main,
      city: null,
      state: null,
      zip: null,
      lat: null,
      lng: null,
      provider: "google",
      needsDetails: true,
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

type Component = { longText?: string; shortText?: string; types?: string[] };

/** Place Details → a filled suggestion; null when it isn't a US place. */
export function mapDetails(body: unknown): AddressSuggestion | null {
  const b = body as { id?: string; formattedAddress?: string; addressComponents?: Component[]; location?: { latitude?: unknown; longitude?: unknown } } | null;
  if (!b || !Array.isArray(b.addressComponents)) return null;
  const get = (type: string, short = false) => {
    const c = b.addressComponents!.find((x) => x.types?.includes(type));
    return (short ? c?.shortText : c?.longText)?.trim() || null;
  };
  if ((get("country", true) ?? "").toUpperCase() !== "US") return null;
  const street = [get("street_number"), get("route", true) ?? get("route")].filter(Boolean).join(" ") || get("premise");
  const unit = get("subpremise");
  const address1 = street ? (unit ? `${street} ${/^\d/.test(unit) ? "#" : ""}${unit}` : street) : null;
  const city = get("locality") ?? get("postal_town") ?? get("sublocality_level_1") ?? get("sublocality") ?? get("administrative_area_level_3") ?? get("neighborhood");
  const state = stateCode(get("administrative_area_level_1", true));
  const zip5 = usZip(get("postal_code"));
  const suffix = get("postal_code_suffix");
  const zip = zip5 && suffix && /^\d{4}$/.test(suffix) && zip5.length === 5 ? `${zip5}-${suffix}` : zip5;
  const lat = Number(b.location?.latitude);
  const lng = Number(b.location?.longitude);
  const pinned = validLatLng(lat, lng);
  return {
    id: `google:${b.id ?? ""}`,
    label: (b.formattedAddress ?? "").replace(/,\s*(USA|United States)$/i, "") || [address1, city, state].filter(Boolean).join(", "),
    address1,
    city,
    state,
    zip,
    lat: pinned ? round6(lat) : null,
    lng: pinned ? round6(lng) : null,
    provider: "google",
  };
}

type Opts = { key: string; fetchImpl?: typeof fetch; signal?: AbortSignal };

export async function googleSuggest(q: string, near: LatLngBias | null, sessionToken: string | null, opts: Opts): Promise<AddressSuggestion[]> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(AUTOCOMPLETE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": opts.key },
    body: JSON.stringify(autocompleteBody(q, near, sessionToken)),
    signal: opts.signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google autocomplete http_${res.status}`);
  return mapAutocomplete(await res.json());
}

export function detailsUrl(placeId: string, sessionToken: string | null): string {
  const p = new URLSearchParams({ languageCode: "en", regionCode: "us" });
  if (sessionToken) p.set("sessionToken", sessionToken);
  return `${DETAILS_URL}${encodeURIComponent(placeId)}?${p.toString()}`;
}

export async function googleDetails(placeId: string, sessionToken: string | null, opts: Opts): Promise<AddressSuggestion | null> {
  const f = opts.fetchImpl ?? fetch;
  const res = await f(detailsUrl(placeId, sessionToken), {
    headers: { "X-Goog-Api-Key": opts.key, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
    signal: opts.signal,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`google details http_${res.status}`);
  return mapDetails(await res.json());
}
