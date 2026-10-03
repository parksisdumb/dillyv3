import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/database.types";

/** Service-role Supabase client (RLS bypassed). Agents always write with tenant_id set explicitly. */
export type Db = SupabaseClient<Database>;
export type { Json };

/**
 * Service-role client, imported lazily so modules that only *type* against Db
 * (and their unit tests) never pull in `server-only` / `next/headers`.
 */
export async function adminDb(): Promise<Db> {
  const { supabaseAdmin } = await import("@/lib/supabase/server");
  return supabaseAdmin() as unknown as Db;
}

/** Throw a readable error for a failed supabase-js call. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** Like `must`, for `.single()` calls: also throws when no row came back. */
export function mustRow<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  const data = must(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no row returned`);
  return data as NonNullable<T>;
}

/** Coerce any serialisable value into the generated Json type. */
export function toJson(v: unknown): Json {
  return v === undefined ? null : (JSON.parse(JSON.stringify(v)) as Json);
}
