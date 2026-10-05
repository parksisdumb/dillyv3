import "server-only";
// Provider choice + caching for /api/address/suggest and /api/address/details. Never imported by client code.
import { fakeSuggest } from "./fake";
import { googleDetails, googleSuggest } from "./google";
import { LruCache } from "./limits";
import { photonSuggest } from "./photon";
import type { AddressSuggestion, LatLngBias } from "./types";

export type ProviderName = "google" | "photon" | "fake" | "off";

/** DILLY_ADDRESS_PROVIDER (google | photon | fake | off) wins; else Google when GOOGLE_MAPS_API_KEY is set, else Photon. */
export function addressProvider(): ProviderName {
  const forced = process.env.DILLY_ADDRESS_PROVIDER?.trim().toLowerCase();
  if (forced === "photon" || forced === "fake" || forced === "off") return forced;
  if (forced === "google") return googleKey() ? "google" : "photon";
  return googleKey() ? "google" : "photon";
}

const googleKey = () => process.env.GOOGLE_MAPS_API_KEY?.trim() || null;

const PROVIDER_TIMEOUT_MS = 3_000;
const photonCache = new LruCache<AddressSuggestion[]>(500, 10 * 60_000);

const timeoutSignal = (outer?: AbortSignal) => {
  const t = AbortSignal.timeout(PROVIDER_TIMEOUT_MS);
  return outer ? AbortSignal.any([outer, t]) : t;
};

export async function suggestAddresses(
  q: string,
  near: LatLngBias | null,
  opts: { sessionToken?: string | null; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<{ provider: ProviderName; suggestions: AddressSuggestion[]; cached?: boolean }> {
  const provider = addressProvider();
  if (provider === "off") return { provider, suggestions: [] };
  if (provider === "fake") return { provider, suggestions: fakeSuggest(q) };
  if (provider === "google") {
    const suggestions = await googleSuggest(q, near, opts.sessionToken ?? null, { key: googleKey()!, fetchImpl: opts.fetchImpl, signal: timeoutSignal(opts.signal) });
    return { provider, suggestions };
  }
  const key = `${q.toLowerCase().replace(/\s+/g, " ").trim()}|${near ? `${near.lat.toFixed(1)},${near.lng.toFixed(1)}` : ""}`;
  const hit = photonCache.get(key);
  if (hit) return { provider, suggestions: hit, cached: true };
  const suggestions = await photonSuggest(q, near, { fetchImpl: opts.fetchImpl, signal: timeoutSignal(opts.signal) });
  photonCache.set(key, suggestions);
  return { provider, suggestions };
}

/** Google only: the picked place's components + coordinates (ends the billing session). */
export async function addressDetails(placeId: string, sessionToken: string | null, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch } = {}) {
  const key = googleKey();
  if (!key || addressProvider() !== "google") return null;
  return googleDetails(placeId, sessionToken, { key, fetchImpl: opts.fetchImpl, signal: timeoutSignal(opts.signal) });
}
