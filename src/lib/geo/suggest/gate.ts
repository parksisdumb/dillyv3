import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { log, newId, REQUEST_ID_HEADER } from "@/lib/observability/log";
import { LruCache, slidingWindow } from "@/lib/geo/suggest/limits";
import type { LatLngBias } from "@/lib/geo/suggest/types";

export const json = (status: number, body: Record<string, unknown>, requestId: string, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { [REQUEST_ID_HEADER]: requestId, "Cache-Control": "no-store", ...extra } });

/** 60 lookups per user per minute (a 250 ms debounce means ~4/s at the very most while typing). */
const limiter = slidingWindow(60, 60_000);
const marketCenter = new LruCache<LatLngBias | null>(200, 10 * 60_000);

export type Gate = { ok: true; requestId: string; userId: string; tenantId: string; sb: Awaited<ReturnType<typeof supabaseServer>> } | { ok: false; res: NextResponse };

/** Signed in, a member of a tenant, under the rate limit. */
export async function gate(req: NextRequest): Promise<Gate> {
  const requestId = req.headers.get(REQUEST_ID_HEADER) ?? newId();
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return { ok: false, res: json(401, { ok: false, error: "Sign in again." }, requestId) };
  let tenantId: string;
  try {
    tenantId = (await getSession()).tenant.id;
  } catch (err) {
    if (err instanceof Error && /NEXT_REDIRECT/.test(err.message)) return { ok: false, res: json(403, { ok: false, error: "No company." }, requestId) };
    log.warn("address:session", { requestId, user: user.id, err });
    return { ok: false, res: json(503, { ok: false, error: "Can't reach the server right now." }, requestId) };
  }
  const wait = limiter.take(user.id);
  if (wait > 0) {
    log.warn("address:rate-limited", { requestId, user: user.id });
    return { ok: false, res: json(429, { ok: false, error: "Slow down a little." }, requestId, { "Retry-After": String(Math.ceil(wait / 1000)) }) };
  }
  return { ok: true, requestId, userId: user.id, tenantId, sb };
}

/** The tenant's primary market center (public.market.center_lat/lng) — the default search bias. */
export async function tenantBias(sb: Awaited<ReturnType<typeof supabaseServer>>, tenantId: string): Promise<LatLngBias | null> {
  const cached = marketCenter.get(tenantId);
  if (cached !== undefined) return cached;
  let bias: LatLngBias | null = null;
  try {
    const { data: tm } = await sb.from("tenant_market").select("market_id,role").eq("tenant_id", tenantId);
    const pick = (tm ?? []).find((m) => m.role === "primary") ?? (tm ?? [])[0];
    if (pick) {
      const { data: m } = await sb.from("market").select("center_lat,center_lng").eq("id", pick.market_id).maybeSingle();
      if (m?.center_lat != null && m?.center_lng != null) bias = { lat: Number(m.center_lat), lng: Number(m.center_lng) };
    }
  } catch {
    bias = null;
  }
  marketCenter.set(tenantId, bias);
  return bias;
}
