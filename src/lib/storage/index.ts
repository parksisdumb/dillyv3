import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDriver } from "@/lib/storage/local";
import { supabaseDriver } from "@/lib/storage/supabase";
import type { StorageDriver } from "@/lib/storage/types";

export type { StorageDriver } from "@/lib/storage/types";
export { SIGNED_URL_TTL_SEC } from "@/lib/storage/types";

/** STORAGE_DRIVER=local → disk (dev / e2e); anything else → Supabase Storage. */
export function storageDriverName(): "local" | "supabase" {
  return process.env.STORAGE_DRIVER?.trim().toLowerCase() === "local" ? "local" : "supabase";
}

/** The driver for this request. `sb` is the signed-in user's Supabase client (RLS-scoped storage). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- works with any typed client
export function storageFor(sb: SupabaseClient<any, any, any>): StorageDriver {
  return storageDriverName() === "local" ? localDriver() : supabaseDriver(sb);
}
