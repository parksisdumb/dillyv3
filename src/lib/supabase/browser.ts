"use client";
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/db/database.types";
import { resilientFetch } from "@/lib/supabase/fetch";

// Phones on one bar: give each attempt 10 s, retry idempotent reads once, never retry writes.
const browserFetch = resilientFetch({ timeoutMs: 10_000, retries: 1, label: "browser" });

export function supabaseBrowser() {
  return createBrowserClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: browserFetch },
    db: { retry: false },
  });
}
