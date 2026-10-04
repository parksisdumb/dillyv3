import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/database.types";
import { env } from "@/lib/env";
import { defaultTimeoutMs, resilientFetch } from "@/lib/supabase/fetch";

// One fetch per process: per-attempt timeout + one retry for idempotent reads; writes never retried.
// db.retry=false turns off postgrest-js's own 3× retry so the two policies don't multiply.
const userFetch = resilientFetch({ timeoutMs: defaultTimeoutMs(), retries: 1, label: "server" });
// Agents/cron: a little more patience (no user is waiting on a phone), same retry rule.
const adminFetch = resilientFetch({ timeoutMs: Math.max(defaultTimeoutMs(), 15_000), retries: 1, label: "admin" });

/** Per-request client acting as the signed-in user. RLS applies. */
export async function supabaseServer() {
  const store = await cookies();
  const e = env();
  return createServerClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { fetch: userFetch },
    db: { retry: false },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => {
        try {
          all.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: middleware refreshes the session instead.
        }
      },
    },
  });
}

/** Service-role client for agents, cron and webhooks. Bypasses RLS — never expose to the browser. */
export function supabaseAdmin() {
  const e = env();
  if (!e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createPlainClient<Database>(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: adminFetch },
    db: { retry: false },
  });
}
