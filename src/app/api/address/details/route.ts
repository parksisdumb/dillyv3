import type { NextRequest } from "next/server";
import { log } from "@/lib/observability/log";
import { gate, json } from "@/lib/geo/suggest/gate";
import { addressDetails } from "@/lib/geo/suggest";
import { PLACE_ID_RE, SESSION_TOKEN_RE } from "@/lib/geo/suggest/google";

/**
 * GET /api/address/details?id=<google place id>&session=<token> → { ok, suggestion } — Google only.
 * Called once when the rep picks a Google suggestion; the session token ties it to that typing session (one bill).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id") ?? "";
  if (!PLACE_ID_RE.test(id)) return json(400, { ok: false, error: "Bad place id." }, g.requestId);
  const rawSession = sp.get("session");
  const sessionToken = rawSession && SESSION_TOKEN_RE.test(rawSession) ? rawSession : null;
  try {
    const suggestion = await addressDetails(id, sessionToken, { signal: req.signal });
    if (!suggestion) return json(404, { ok: false, error: "Not a US address." }, g.requestId);
    return json(200, { ok: true, suggestion }, g.requestId);
  } catch (err) {
    log.warn("address:details:failed", { requestId: g.requestId, user: g.userId, err });
    return json(502, { ok: false, error: "Couldn't fetch that address." }, g.requestId);
  }
}
