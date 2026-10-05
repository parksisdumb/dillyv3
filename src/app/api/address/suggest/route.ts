import type { NextRequest } from "next/server";
import { log } from "@/lib/observability/log";
import { gate, json, tenantBias } from "@/lib/geo/suggest/gate";
import { suggestAddresses } from "@/lib/geo/suggest";
import { SESSION_TOKEN_RE } from "@/lib/geo/suggest/google";
import { MAX_QUERY, MIN_QUERY, parseNear } from "@/lib/geo/suggest/types";

/**
 * GET /api/address/suggest?q=…&near=lat,lng&session=<token> → { ok, provider, suggestions: AddressSuggestion[] ≤ 6 }
 * Signed-in tenant members only; 60/min per user. Providers are called from here, never from the browser.
 * Bias: `near` (the rep's location) or the tenant's primary market center.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await gate(req);
  if (!g.ok) return g.res;
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) return json(400, { ok: false, error: `Type at least ${MIN_QUERY} characters.` }, g.requestId);
  const rawSession = sp.get("session");
  const sessionToken = rawSession && SESSION_TOKEN_RE.test(rawSession) ? rawSession : null;
  const near = parseNear(sp.get("near")) ?? (await tenantBias(g.sb, g.tenantId));
  const started = Date.now();
  try {
    const r = await suggestAddresses(q, near, { sessionToken, signal: req.signal });
    log.debug("address:suggest", { requestId: g.requestId, provider: r.provider, n: r.suggestions.length, cached: !!r.cached, durationMs: Date.now() - started });
    return json(200, { ok: true, provider: r.provider, suggestions: r.suggestions }, g.requestId);
  } catch (err) {
    if (req.signal.aborted) return json(499, { ok: false, error: "cancelled" }, g.requestId);
    log.warn("address:suggest:failed", { requestId: g.requestId, user: g.userId, durationMs: Date.now() - started, err });
    // The form keeps working as plain text inputs.
    return json(502, { ok: false, error: "Suggestions are unavailable right now.", suggestions: [] }, g.requestId);
  }
}
