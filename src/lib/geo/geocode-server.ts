import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { log } from "@/lib/observability/log";
import { geocodeAddress, oneLineAddress, rateLimiter, type GeocodeOutcome } from "@/lib/geo/census";

type Db = SupabaseClient<Database>;
type Row = { id: string; tenant_id: string; address1: string | null; city: string | null; state: string | null; zip: string | null };

/** DILLY_GEOCODER=off disables outbound geocoding (tests, or if the Census API misbehaves). */
export function geocoderEnabled(): boolean {
  return process.env.DILLY_GEOCODER?.trim().toLowerCase() !== "off";
}

/** Errored rows are retried after this long; no-match rows are not retried until the address changes. */
const RETRY_ERRORS_AFTER_MS = 6 * 3600_000;
export const CENSUS_RPS = 5;

/** Geocode these properties now (≤ 5 req/s) and cache the result on the row. Returns per-status counts. */
export async function geocodeRows(db: Db, rows: Row[], opts: { geocode?: (a: string) => Promise<GeocodeOutcome>; throttle?: () => Promise<void> } = {}) {
  const geocode = opts.geocode ?? ((a: string) => geocodeAddress(a));
  const throttle = opts.throttle ?? rateLimiter(CENSUS_RPS);
  const counts = { ok: 0, nomatch: 0, error: 0, skipped: 0 };
  for (const r of rows) {
    const address = oneLineAddress(r);
    const now = new Date().toISOString();
    if (!address) {
      counts.skipped++;
      await db.from("property").update({ geocoded_at: now, geocode_source: "census_nomatch" }).eq("id", r.id).is("lat", null);
      continue;
    }
    await throttle();
    const g = await geocode(address);
    if (g.status === "ok") {
      counts.ok++;
      await db.from("property").update({ lat: g.lat, lng: g.lng, geocoded_at: now, geocode_source: "census" }).eq("id", r.id).is("lat", null);
    } else {
      counts[g.status]++;
      await db
        .from("property")
        .update({ geocoded_at: now, geocode_source: g.status === "nomatch" ? "census_nomatch" : "census_error" })
        .eq("id", r.id)
        .is("lat", null);
      if (g.status === "error") log.warn("geocode:error", { tenant: r.tenant_id, property: r.id, error: g.error });
    }
  }
  return counts;
}

const COLS = "id,tenant_id,address1,city,state,zip";

/** The next batch of buildings that need a pin: never tried, or errored a while ago. Oldest first (resumable). */
export async function nextGeocodeBatch(db: Db, limit = 25): Promise<Row[]> {
  const retryBefore = new Date(Date.now() - RETRY_ERRORS_AFTER_MS).toISOString();
  const { data, error } = await db
    .from("property")
    .select(COLS)
    .is("lat", null)
    .not("address1", "is", null)
    .is("duplicate_of", null)
    .or(`geocoded_at.is.null,and(geocode_source.eq.census_error,geocoded_at.lt.${retryBefore})`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`geocode batch: ${error.message}`);
  return (data ?? []) as Row[];
}

/** Geocode specific properties if they still lack a pin (property create/edit, today's Go stops). */
export async function geocodePropertyIds(db: Db, ids: string[]) {
  if (!geocoderEnabled() || ids.length === 0) return null;
  const { data } = await db.from("property").select(COLS).in("id", ids.slice(0, 25)).is("lat", null).is("geocoded_at", null);
  return data?.length ? geocodeRows(db, data as Row[]) : null;
}

/** Service-role client when configured (after() callbacks run outside the request's cookie scope). */
export async function geocodeDb(): Promise<Db | null> {
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/server");
    return supabaseAdmin() as unknown as Db;
  } catch {
    return null;
  }
}

/** Fire-and-forget from a request: geocode after the response is sent. Never throws. */
export async function geocodeSoon(ids: string[]) {
  if (!geocoderEnabled() || ids.length === 0) return;
  try {
    const db = await geocodeDb();
    if (db) await geocodePropertyIds(db, ids);
  } catch (err) {
    log.warn("geocode:after-failed", { err, n: ids.length });
  }
}
