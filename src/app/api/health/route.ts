import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { log, newId, REQUEST_ID_HEADER } from "@/lib/observability/log";
import { resilientFetch } from "@/lib/supabase/fetch";

/**
 * Uptime probe for Vercel monitoring / UptimeRobot / Better Stack:  GET /api/health
 *
 *   200 {"ok":true,"version":"<git sha>","db":{"ok":true,"latencyMs":23},"auth":{"ok":true,"latencyMs":41},…}
 *   503 when the database or auth can't be reached (the app can't serve reps without either).
 *
 * Uses only the public anon key and calls `public.health()` (returns now(), touches no tables).
 * Never returns secrets, env values or error details beyond a short reason code.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const PROBE_TIMEOUT_MS = 3_000;
const probeFetch = resilientFetch({ timeoutMs: PROBE_TIMEOUT_MS, retries: 0, label: "health" });

type Check = { ok: boolean; latencyMs: number | null; reason?: string };

async function timed(fn: () => Promise<{ ok: boolean; reason?: string }>): Promise<Check> {
  const t = Date.now();
  try {
    const r = await fn();
    return { ok: r.ok, latencyMs: Date.now() - t, ...(r.reason ? { reason: r.reason } : {}) };
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    return { ok: false, latencyMs: Date.now() - t, reason: name === "AbortError" ? "timeout" : "unreachable" };
  }
}

export async function GET(request: Request) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) ?? newId();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const version = (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 12);

  let db: Check;
  let auth: Check;
  if (!url || !key) {
    db = { ok: false, latencyMs: null, reason: "not_configured" };
    auth = { ok: false, latencyMs: null, reason: "not_configured" };
  } else {
    const sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: probeFetch },
      db: { retry: false },
    });
    [db, auth] = await Promise.all([
      timed(async () => {
        const { error } = await sb.rpc("health");
        if (!error) return { ok: true };
        // PostgREST answered from a live connection but the function isn't deployed: the DB is up, the
        // migration is missing. Report it without paging anyone as an outage.
        if (error.code === "PGRST202") return { ok: true, reason: "health_fn_missing" };
        const msg = error.message ?? "";
        const reason =
          msg.startsWith("AbortError")
            ? "timeout"
            : !error.code && /^(TypeError|FetchError)|fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)
              ? "unreachable"
              : "error";
        return { ok: false, reason };
      }),
      timed(async () => {
        const res = await probeFetch(`${url.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: key }, cache: "no-store" });
        await res.body?.cancel().catch(() => {});
        return res.ok ? { ok: true } : { ok: false, reason: `http_${res.status}` };
      }),
    ]);
  }

  const ok = db.ok && auth.ok;
  if (!ok) log.error("health:degraded", { requestId, route: "/api/health", db, auth });

  return NextResponse.json(
    { ok, version, region: process.env.VERCEL_REGION ?? null, db, auth, time: new Date().toISOString() },
    {
      status: ok ? 200 : 503,
      headers: { "cache-control": "no-store, max-age=0", [REQUEST_ID_HEADER]: requestId },
    },
  );
}
