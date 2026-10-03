"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";

export function supabaseBrowser() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
