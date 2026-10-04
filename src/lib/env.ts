import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Model ids per tier. Set to the current Claude model ids in Vercel env; the runtime never hardcodes them.
  DILLY_MODEL_OPUS: z.string().min(1).optional(),
  DILLY_MODEL_SONNET: z.string().min(1).optional(),
  DILLY_MODEL_HAIKU: z.string().min(1).optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  // Reliability knobs. Plain optional strings ON PURPOSE: a typo here must never stop the app from booting;
  // each reader parses and falls back to its default.
  DILLY_SUPABASE_TIMEOUT_MS: z.string().optional(), // per-attempt DB timeout, default 8000 (src/lib/supabase/fetch.ts)
  DILLY_LLM_TIMEOUT_MS: z.string().optional(), // per-call Anthropic timeout, default 30000 (src/agents/runtime/llm.ts)
  LOG_LEVEL: z.string().optional(), // debug | info | warn | error (default info)
  // TODO(sentry): error reporting. When set, install @sentry/nextjs and register it via setErrorReporter()
  // in src/lib/observability/log.ts. Unused until then.
  SENTRY_DSN: z.string().optional(),
});

/** Required to boot: without these every page fails. Everything else degrades (see docs/RUNBOOK.md). */
export const REQUIRED_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;
export function env(): Env {
  if (cached) return cached;
  // An empty value in the Vercel dashboard means "unset", not "invalid".
  // NEXT_PUBLIC_* are referenced literally so the values Next inlines at build time are used even when the
  // runtime environment lacks them (iterating process.env only sees runtime values).
  const raw: Record<string, string | undefined> = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
  const source = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v === "" ? undefined : v]));
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      "Missing or invalid environment variables: " +
        parsed.error.issues.map((i) => i.path.join(".")).join(", ") +
        ". Copy .env.example to .env.local and fill it in.",
    );
  }
  cached = parsed.data;
  return cached;
}
